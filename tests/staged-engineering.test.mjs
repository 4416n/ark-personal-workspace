import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { createApp } from "../server/index.mjs";
import { seedWorkspace } from "../src/domain.ts";
import { requirements } from "../server/requirements.mjs";
import {
  acceptanceRequirements,
  createPipeline,
  applyStageOutput,
  reviewEvidence,
} from "../server/engineering-stages.mjs";
import { decodeFullBackup, backupDigest } from "../server/full-backup.mjs";
import { fullstackFixture } from "./fixtures/fullstack.mjs";
import { stagedResponse } from "./fixtures/staged.mjs";
import { removeTestDirectory } from "./helpers/filesystem.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 500; i++) {
    const value = await fn();
    if (value) return value;
    await wait(10);
  }
  throw new Error("staged test timeout");
}
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-staged-test-"));
  let app, server, base;
  const calls = [];
  let respond = stagedResponse;
  let verify = async () => ({
    passed: true,
    checks: [{ name: "样例检查", passed: true, detail: "模拟结果" }],
    logs: "模拟验证",
    scope: "mock only",
  });
  const upstream = http
    .createServer(async (req, res) => {
      let raw = "";
      for await (const b of req) raw += b;
      const body = JSON.parse(raw);
      calls.push(body);
      const content = await respond(body);
      if (content === "HOLD") return;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
      );
    })
    .listen(0, "127.0.0.1");
  await new Promise((r) => upstream.once("listening", r));
  const boot = async () => {
    app = createApp({
      shared: true,
      configPath: path.join(dir, "ai-config.json"),
      softwareOptions: {
        validator: (...args) => verify(...args),
        capability: async () => ({ available: true, reason: "mock" }),
      },
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => {
    await app.locals.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  };
  const req = async (
    route,
    body,
    method = body === undefined ? "GET" : "POST",
  ) => {
    const res = await fetch(base + "/api" + route, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  await boot();
  const state = seedWorkspace();
  state.projects = state.projects.slice(0, 1);
  state.tasks = [];
  state.knowledge = [];
  state.projects[0].goal = "实现笔记新增和持久化查询";
  state.projects[0].successCriteria = "笔记重启后保留";
  state.projects[0].deliveryType = "software";
  const id = state.projects[0].id;
  await req("/workspace", { state, revision: 0 }, "PUT");
  await req("/config", {
    provider: "mock",
    model: "mock",
    apiKey: "TEST-ONLY-KEY",
    baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
  });
  const start = (options = {}) =>
    req(`/software/${id}/start`, {
      confirmed: true,
      allowSandbox: true,
      revision: 1,
      maxRepairs: 0,
      workflow: "staged",
      ...options,
    });
  const get = async (id) => (await req(`/software-builds/${id}`)).body;
  const settled = (id) =>
    until(async () => {
      const b = await get(id);
      return (
        ["verified", "failed", "cancelled", "interrupted"].includes(b.status) &&
        b
      );
    });
  const resume = (b, extraAttempts = 0, overrides = {}) =>
    req(`/software-builds/${b.id}/resume`, {
      confirmed: true,
      allowSandbox: true,
      revision: 1,
      checkpointRevision: b.pipeline.revision,
      extraAttempts,
      ...overrides,
    });
  t.after(async () => {
    await stop();
    upstream.closeAllConnections();
    await new Promise((r) => upstream.close(r));
    await removeTestDirectory(dir);
  });
  return {
    dir,
    req,
    start,
    get,
    settled,
    resume,
    calls,
    state,
    id,
    get base() {
      return base;
    },
    respond: (f) => {
      respond = f;
    },
    verify: (f) => {
      verify = f;
    },
    reboot: async () => {
      await stop();
      await boot();
    },
  };
}
const stageOf = (body) =>
  /^本次阶段：(\w+)/.exec(body.messages.at(-1).content)?.[1];

test("stage scopes reject traversal/cross-stage changes and commit patches atomically", () => {
  const state = seedWorkspace(),
    input = requirements(state, state.projects[0].id);
  const p = createPipeline(input, [], 0);
  const good = fullstackFixture();
  for (const name of [
    "src/main.jsx",
    "../secret",
    "scripts/verify.mjs",
    "server/start.mjs",
  ])
    assert.throws(() =>
      applyStageOutput(
        p,
        "backend",
        JSON.stringify({
          summary: "bad",
          files: [{ path: name, content: "malicious" }],
        }),
      ),
    );
  assert.equal(p.draft.length, 0);
  const backend = good.files.filter((f) => f.path.startsWith("server/"));
  p.draft = backend;
  assert.throws(() =>
    applyStageOutput(
      p,
      "frontend",
      JSON.stringify({
        summary: "bad",
        files: [{ path: "server/app.mjs", content: "overwrite" }],
      }),
    ),
  );
  assert.deepEqual(p.draft, backend);
  const next = applyStageOutput(
    p,
    "frontend",
    JSON.stringify({
      summary: "UI",
      files: good.files.filter((f) => f.path.startsWith("src/")),
    }),
  );
  assert.equal(
    next.draft.find((f) => f.path === "server/app.mjs").content,
    backend[0].content,
  );
});
test("acceptance inventory preserves every criterion and rejects forged/missing evidence", () => {
  const input = {
    project: {
      title: "网站",
      goal: "完整目标",
      successCriteria: "验收甲\n验收乙",
    },
    tasks: [
      {
        id: "t",
        title: "任务",
        description: "完整说明",
        acceptanceCriteria: ["标准1", "标准2"],
        executionMode: "human",
      },
    ],
    knowledge: [],
  };
  const criteria = acceptanceRequirements(input);
  assert.equal(criteria.length, 5);
  assert.equal(criteria[1].criterion, "验收甲\n验收乙");
  const build = {
    pipeline: { requirements: criteria },
    files: fullstackFixture().files,
    sourceHash: "hash",
    requirementsHash: "r",
    validation: { passed: true, checks: [{ name: "build", passed: true }] },
  };
  const response = {
    items: criteria.map((r) => ({
      id: r.id,
      recommendation: "supported",
      reason: "checked",
      files: [
        { path: "server/app.mjs", quote: "CREATE TABLE IF NOT EXISTS notes" },
      ],
      checkIndexes: [0],
    })),
  };
  const report = reviewEvidence(JSON.stringify(response), build);
  assert.equal(report.complete, false);
  assert.equal(report.items[2].recommendation, "manual");
  assert.ok(report.items.every((r) => r.decision === null));
  const missing = structuredClone(response);
  missing.items.pop();
  assert.throws(
    () => reviewEvidence(JSON.stringify(missing), build),
    /未完整覆盖/,
  );
  response.items[0].files[0].quote = "invented evidence";
  assert.throws(
    () => reviewEvidence(JSON.stringify(response), build),
    /不存在/,
  );
  response.items[0].files = [];
  response.items[0].checkIndexes = [100];
  assert.throws(
    () => reviewEvidence(JSON.stringify(response), build),
    /不存在/,
  );
});
test("staged delivery persists 5 model stages, usage, files and unapproved requirement evidence", async (t) => {
  const f = await fixture(t);
  const start = await f.start();
  assert.equal(start.status, 200);
  const b = await f.settled(start.body.id);
  assert.equal(b.status, "verified", b.error);
  assert.deepEqual(f.calls.map(stageOf), [
    "contract",
    "backend",
    "frontend",
    "integration",
    "review",
  ]);
  assert.equal(
    b.pipeline.events.reduce((n, e) => n + e.usage.total, 0),
    150,
  );
  assert.equal(b.pipeline.next, null);
  assert.equal(b.acceptance.complete, false);
  assert.equal(b.acceptance.items.length, 2);
  assert.ok(b.acceptance.items.every((r) => !r.decision));
  assert.ok(!JSON.stringify(b).includes("TEST-ONLY-KEY"));
  const zip = Buffer.from(
    await (
      await fetch(f.base + `/api/software-builds/${b.id}/download`)
    ).arrayBuffer(),
  );
  assert.ok(zip.includes(Buffer.from('"acceptance"')));
  assert.ok(zip.includes(Buffer.from("server/app.mjs")));
});
test("failed frontend resumes after restart without repeating prior stages or clearing usage", async (t) => {
  const f = await fixture(t);
  f.respond((body) =>
    stageOf(body) === "frontend" ? "bad JSON" : stagedResponse(body),
  );
  let b = await f.settled((await f.start()).body.id);
  assert.equal(b.status, "failed");
  assert.equal(b.pipeline.next, "frontend");
  assert.equal(b.files.length, 0);
  assert.equal(b.pipeline.draftFiles.length, 1);
  const source = (
    await f.req(`/software-builds/${b.id}/file?path=server/app.mjs`)
  ).body.content;
  assert.match(source, /DatabaseSync/);
  assert.equal(
    (await f.req(`/software-builds/${b.id}/pin`, { pinned: true })).status,
    200,
  );
  const before = f.calls.length;
  await f.reboot();
  await wait(50);
  assert.equal(f.calls.length, before);
  b = await f.get(b.id);
  assert.equal((await f.resume(b)).status, 400);
  f.respond(stagedResponse);
  assert.equal((await f.resume(b, 1)).status, 200);
  b = await f.settled(b.id);
  assert.equal(b.status, "verified", b.error);
  assert.deepEqual(f.calls.map(stageOf), [
    "contract",
    "backend",
    "frontend",
    "frontend",
    "integration",
    "review",
  ]);
  assert.equal(b.pipeline.stages.find((s) => s.id === "frontend").calls, 2);
  assert.equal(
    (await f.req(`/software-builds/${b.id}/file?path=server/app.mjs`)).body
      .content,
    source,
  );
});
test("active cancellation and shutdown retain checkpoints, reject double resume and stale confirmations", async (t) => {
  const f = await fixture(t);
  f.respond((body) =>
    stageOf(body) === "frontend" ? "HOLD" : stagedResponse(body),
  );
  const id = (await f.start()).body.id;
  await until(() => f.calls.some((b) => stageOf(b) === "frontend"));
  assert.equal(
    (await f.req(`/software-builds/${id}/cancel`, {})).body.cancelled,
    true,
  );
  let b = await f.settled(id);
  assert.equal(b.pipeline.next, "frontend");
  assert.equal((await f.resume(b, 1, { confirmed: false })).status, 400);
  assert.equal((await f.resume(b, 1, { checkpointRevision: 0 })).status, 409);
  assert.equal((await f.resume(b, 1, { revision: 0 })).status, 400);
  const results = await Promise.all([f.resume(b, 1), f.resume(b, 1)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  await until(
    () => f.calls.filter((b) => stageOf(b) === "frontend").length === 2,
  );
  await f.reboot();
  b = await f.get(id);
  assert.equal(b.status, "interrupted");
  assert.equal(b.pipeline.stages.find((s) => s.id === "backend").calls, 1);
  f.respond(stagedResponse);
  assert.equal((await f.resume(b, 1)).status, 200);
  assert.equal((await f.settled(id)).status, "verified");
});
test("changed requirements block recovery while failed review keeps actual runtime results", async (t) => {
  const f = await fixture(t);
  f.respond((body) =>
    stageOf(body) === "review" ? '{"items":[]}' : stagedResponse(body),
  );
  const b = await f.settled((await f.start()).body.id);
  assert.equal(b.pipeline.next, "review");
  assert.equal(b.validation.passed, true);
  assert.equal(b.status, "failed");
  assert.equal(b.acceptance.complete, false);
  const s = (await f.req("/workspace")).body;
  s.state.projects[0].goal += "新增导出";
  await f.req("/workspace", { state: s.state, revision: s.revision }, "PUT");
  assert.equal(
    (await f.resume(b, 1, { revision: s.revision + 1 })).status,
    409,
  );
  assert.equal(f.calls.length, 5);
});
test("cancelling the individual model run stops the entire stage without auto retry", async (t) => {
  const f = await fixture(t);
  f.respond((body) =>
    stageOf(body) === "frontend" ? "HOLD" : stagedResponse(body),
  );
  const id = (await f.start({ maxRepairs: 2 })).body.id;
  const b = await until(async () => {
    const b = await f.get(id);
    return (
      b.pipeline.events.find((e) => e.stage === "frontend" && e.runId) && b
    );
  });
  await f.req(`/runs/${b.pipeline.events.at(-1).runId}/cancel`, {});
  const stopped = await f.settled(id);
  assert.equal(stopped.status, "cancelled");
  await wait(550);
  assert.equal(f.calls.length, 3);
  assert.equal(stopped.pipeline.next, "frontend");
});
test("resume requiring model refuses missing key and uses current configuration only after consent", async (t) => {
  const f = await fixture(t);
  f.respond((body) =>
    stageOf(body) === "frontend" ? "bad" : stagedResponse(body),
  );
  const b = await f.settled((await f.start()).body.id);
  const config = JSON.parse(
    await fs.readFile(path.join(f.dir, "ai-config.json"), "utf8"),
  );
  await fs.writeFile(
    path.join(f.dir, "ai-config.json"),
    JSON.stringify({ ...config, apiKey: "" }),
  );
  assert.equal((await f.resume(b, 1)).status, 400);
  assert.equal(f.calls.length, 3);
  await fs.writeFile(
    path.join(f.dir, "ai-config.json"),
    JSON.stringify({ ...config, model: "changed-model" }),
  );
  f.respond(stagedResponse);
  await f.resume(b, 1);
  await f.settled(b.id);
  assert.equal(f.calls[3].model, "changed-model");
});
test("unavailable sandbox retains complete source, later resumes only validation and review", async (t) => {
  const f = await fixture(t);
  let validations = 0;
  f.verify(async () => {
    validations++;
    return { passed: false, unavailable: true, checks: [], logs: "no sandbox" };
  });
  let b = await f.settled((await f.start({ maxRepairs: 1 })).body.id);
  assert.equal(b.pipeline.next, "validation");
  assert.equal(f.calls.length, 4);
  assert.equal(validations, 1);
  f.verify(async () => {
    validations++;
    return {
      passed: true,
      checks: [{ name: "persist", passed: true }],
      logs: "fixed",
    };
  });
  assert.equal((await f.resume(b)).status, 200);
  b = await f.settled(b.id);
  assert.equal(b.status, "verified", b.error);
  assert.equal(f.calls.length, 5);
  assert.equal(validations, 2);
});
test("repair allowance is bounded and patches keep unrelated files exactly", async (t) => {
  const f = await fixture(t);
  let validations = 0;
  let sources;
  f.verify(async (files) => {
    sources = files;
    validations++;
    return {
      passed: validations > 1,
      checks: [{ name: "runtime", passed: validations > 1, detail: "mock" }],
      logs: "repair-me",
    };
  });
  const b = await f.settled((await f.start({ maxRepairs: 1 })).body.id);
  assert.equal(b.status, "verified");
  assert.equal(validations, 2);
  assert.equal(f.calls.filter((b) => stageOf(b) === "repair").length, 1);
  assert.equal(
    sources.find((f) => f.path === "src/main.jsx").content,
    fullstackFixture().files[0].content,
  );
  f.verify(async () => ({ passed: false, checks: [], logs: "always fail" }));
  const failed = await f.settled((await f.start({ maxRepairs: 1 })).body.id);
  assert.equal(failed.pipeline.next, "repair");
  assert.equal(failed.resume.needsExtra, true);
  assert.equal(failed.pipeline.stages.find((s) => s.id === "repair").calls, 1);
});
test("manual acceptance is explicit and bound to exact source, requirements and checkpoint revision", async (t) => {
  const f = await fixture(t);
  let b = await f.settled((await f.start()).body.id);
  const decide = (options = {}) =>
    f.req(`/software-builds/${b.id}/accept`, {
      confirmed: true,
      revision: 1,
      checkpointRevision: b.pipeline.revision,
      sourceHash: b.sourceHash,
      requirementId: b.acceptance.items[0].id,
      decision: "approved",
      note: "实际新增笔记并重启后确认保留",
      ...options,
    });
  assert.equal((await decide({ confirmed: false })).status, 400);
  assert.equal((await decide({ sourceHash: "a".repeat(64) })).status, 409);
  assert.equal((await decide({ note: "" })).status, 400);
  const first = await decide();
  assert.equal(first.status, 200);
  assert.equal(first.body.acceptance.complete, false);
  assert.equal((await decide()).status, 409);
  b = first.body;
  b = (await decide({ requirementId: b.acceptance.items[1].id })).body;
  assert.equal(b.acceptance.complete, true);
  const oldCalls = f.calls.length;
  const next = await f.req(`/software-builds/${b.id}/revalidate`, {
    confirmed: true,
    allowSandbox: true,
    revision: 1,
  });
  const revalidated = await f.settled(next.body.id);
  assert.equal(revalidated.status, "verified");
  assert.equal(f.calls.length, oldCalls);
  assert.ok(revalidated.acceptance.items.every((r) => r.decision === null));
});
test("repair cannot weaken previously declared tests even with a valid new contract", async (t) => {
  const f = await fixture(t);
  let validations = 0;
  f.verify(async () => {
    validations++;
    return { passed: false, checks: [], logs: "failing business behavior" };
  });
  f.respond((body) => {
    const out = JSON.parse(stagedResponse(body));
    if (stageOf(body) === "repair")
      out.tests.api[0].contains = "easier assertion";
    return JSON.stringify(out);
  });
  const b = await f.settled((await f.start({ maxRepairs: 1 })).body.id);
  assert.equal(b.status, "failed");
  assert.equal(validations, 1);
  assert.match(b.error, /不能修改既有测试/);
  const declaration = (
    await f.req(`/software-builds/${b.id}/file?path=tests/acceptance.json`)
  ).body.content;
  assert.equal(declaration.includes("easier assertion"), false);
});
test("reviewed missing requirements trigger bounded targeted repair, never automatic approval", async (t) => {
  const f = await fixture(t);
  let reviews = 0;
  f.respond((body) => {
    const out = JSON.parse(stagedResponse(body));
    if (stageOf(body) === "review") {
      reviews++;
      out.items[0].recommendation = "missing";
      out.items[0].reason = "业务缺少目标要求的标签过滤";
    }
    return JSON.stringify(out);
  });
  const b = await f.settled((await f.start({ maxRepairs: 1 })).body.id);
  assert.equal(reviews, 2);
  assert.equal(f.calls.filter((b) => stageOf(b) === "repair").length, 1);
  assert.ok(
    f.calls
      .find((b) => stageOf(b) === "repair")
      .messages.at(-1)
      .content.includes("标签过滤"),
  );
  assert.equal(b.pipeline.next, null);
  assert.equal(b.acceptance.items[0].recommendation, "missing");
  assert.equal(b.acceptance.complete, false);
  assert.ok(b.acceptance.items.every((r) => !r.decision));
});
test("full backup preserves partial drafts but resets restored validations and approvals", async (t) => {
  const f = await fixture(t);
  f.respond((body) =>
    stageOf(body) === "frontend" ? "broken" : stagedResponse(body),
  );
  const partial = await f.settled((await f.start()).body.id);
  let bytes = Buffer.from(
    await (await fetch(f.base + "/api/full-backup")).arrayBuffer(),
  );
  const restored = (await decodeFullBackup(bytes)).data.builds.find(
    (b) => b.id === partial.id,
  );
  assert.equal(restored.pipeline.next, "frontend");
  assert.equal(restored.pipeline.draft.length, 1);
  assert.equal(
    restored.pipeline.stages.find((s) => s.id === "frontend").calls,
    1,
  );
  f.respond(stagedResponse);
  const complete = await f.settled((await f.start()).body.id);
  bytes = Buffer.from(
    await (await fetch(f.base + "/api/full-backup")).arrayBuffer(),
  );
  const decoded = await decodeFullBackup(bytes),
    b = decoded.data.builds.find((b) => b.id === complete.id);
  assert.equal(b.pipeline.next, "validation");
  assert.equal(b.validation, null);
  assert.equal(b.acceptance.complete, false);
  assert.ok(b.acceptance.items.every((r) => !r.decision));
  b.pipeline.draft[0].path = "../escape";
  const envelope = {
    version: 1,
    format: "ark-full-backup",
    createdAt: new Date().toISOString(),
    data: decoded.data,
    checksum: backupDigest(decoded.data),
  };
  await assert.rejects(decodeFullBackup(gzipSync(JSON.stringify(envelope))));
});
test("restoring a partial full backup can actually resume without repeating completed stages", async (t) => {
  const f = await fixture(t);
  f.respond((body) =>
    stageOf(body) === "frontend" ? "broken" : stagedResponse(body),
  );
  let b = await f.settled((await f.start()).body.id);
  const bytes = Buffer.from(
    await (await fetch(f.base + "/api/full-backup")).arrayBuffer(),
  );
  const response = await fetch(f.base + "/api/full-backup/preview", {
    method: "POST",
    headers: { "content-type": "application/gzip" },
    body: bytes,
  });
  assert.equal(response.status, 200);
  const preview = await response.json();
  const restored = await f.req("/full-backup/restore", {
    token: preview.token,
    confirmed: true,
    revision: 1,
  });
  assert.equal(restored.status, 200);
  b = await f.get(b.id);
  assert.equal(b.status, "restored");
  assert.equal(f.calls.length, 3);
  assert.equal(b.pipeline.next, "frontend");
  f.respond(stagedResponse);
  const resumed = await f.resume(b, 1, { revision: restored.body.revision });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  b = await f.settled(b.id);
  assert.equal(b.status, "verified", b.error);
  assert.deepEqual(f.calls.map(stageOf), [
    "contract",
    "backend",
    "frontend",
    "frontend",
    "integration",
    "review",
  ]);
  assert.equal(b.acceptance.complete, false);
});
