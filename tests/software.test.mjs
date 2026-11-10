import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { createApp } from "../server/index.mjs";
import { openDatabase } from "../server/database.mjs";
import { seedWorkspace } from "../src/domain.ts";
import { projectToTemplate, instantiateTemplate } from "../src/templates.ts";
import {
  parseBundle,
  assembleBundle,
  sourceHash,
  zipFiles,
} from "../server/project-bundle.mjs";
import { fullstackFixture } from "./fixtures/fullstack.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => {
  for (let i = 0; i < 400; i++) {
    const r = await fn();
    if (r) return r;
    await sleep(20);
  }
  throw new Error("Timed out");
};
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-software-test-"));
  let app,
    server,
    base,
    respond = () => JSON.stringify(fullstackFixture()),
    verify = async () => ({
      passed: true,
      checks: [
        { name: "mock verification", passed: true, detail: "mock only" },
      ],
      logs: "fixture output",
      scope: "mock, not real verification",
    });
  const calls = [];
  const upstream = http
    .createServer(async (req, res) => {
      let raw = "";
      for await (const b of req) raw += b;
      calls.push(JSON.parse(raw));
      const content = await respond();
      if (content === "hold") return;
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
        capability: async () => ({ available: true, reason: "mock fixture" }),
      },
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => {
    app.locals.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await sleep(30);
  };
  await boot();
  const req = async (
    route,
    body,
    method = body === undefined ? "GET" : "POST",
  ) => {
    const r = await fetch(base + "/api" + route, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  const state = seedWorkspace();
  state.projects = state.projects.slice(0, 1);
  state.projects[0].deliveryType = "software";
  const id = state.projects[0].id;
  state.tasks = state.tasks.filter((t) => t.projectId === id);
  state.knowledge = [];
  await req("/workspace", { state, revision: 0 }, "PUT");
  await req("/config", {
    provider: "mock",
    model: "mock",
    apiKey: "test-only-secret",
    baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
  });
  const start = async (options = {}) =>
    req(`/software/${id}/start`, {
      revision: (await req("/workspace")).body.revision,
      confirmed: true,
      allowSandbox: true,
      maxRepairs: 1,
      ...options,
    });
  const settled = async (buildId) =>
    until(async () => {
      const b = (await req(`/software-builds/${buildId}`)).body;
      return (
        ["verified", "failed", "cancelled", "interrupted"].includes(b.status) &&
        b
      );
    });
  t.after(async () => {
    await stop();
    upstream.closeAllConnections();
    await new Promise((r) => upstream.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    req,
    start,
    settled,
    calls,
    id,
    state,
    dir,
    get base() {
      return base;
    },
    respond: (fn) => (respond = fn),
    verify: (fn) => (verify = fn),
    reboot: async () => {
      await stop();
      await boot();
    },
  };
}
test("engineering protocol rejects documents, traversal, protected files, duplicates and weak tests", () => {
  const good = fullstackFixture();
  assert.equal(parseBundle(JSON.stringify(good)).files.length, 4);
  assert.equal(
    parseBundle("```json\n" + JSON.stringify(good) + "\n```").summary,
    good.summary,
  );
  for (const name of [
    "../escape.js",
    "src/../escape.js",
    "src//evil.js",
    "server/start.mjs",
    "package.json",
    "public/x.html",
    "src/CON.js",
    "src/a\\b.js",
  ]) {
    const b = structuredClone(good);
    b.files.push({ path: name, content: "bad" });
    assert.throws(() => parseBundle(JSON.stringify(b)), /格式无效/);
  }
  for (const change of [
    (b) => b.files.push({ ...b.files[0] }),
    (b) => b.files.splice(0, 1),
    (b) => (b.tests.api = b.tests.api.filter((t) => t.method === "GET")),
    (b) =>
      (b.tests.browser = [
        { action: "text", value: "title" },
        { action: "text", value: "title" },
      ]),
    (b) => (b.files[0].content = "\0"),
  ]) {
    const b = structuredClone(good);
    change(b);
    assert.throws(() => parseBundle(JSON.stringify(b)));
  }
  assert.throws(() => parseBundle("# Only a plan"));
  assert.throws(() => parseBundle(JSON.stringify(good).slice(0, -4)));
});
test("full ZIP contains actual UTF-8 sources, pinned lock, deployment, tests and correct CRC", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-zip-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const files = await assembleBundle(
    parseBundle(JSON.stringify(fullstackFixture())),
  );
  const zip = path.join(dir, "project.zip");
  await fs.writeFile(zip, zipFiles(files));
  assert.match(
    execFileSync("unzip", ["-t", zip], { encoding: "utf8" }),
    /No errors/,
  );
  execFileSync("unzip", ["-q", zip, "-d", path.join(dir, "out")]);
  for (const f of files)
    assert.equal(
      await fs.readFile(path.join(dir, "out", f.path), "utf8"),
      f.content,
    );
  for (const name of [
    "server/app.mjs",
    "src/main.jsx",
    "package-lock.json",
    "Dockerfile",
    "compose.yaml",
    "tests/acceptance.json",
    "DEPLOY.md",
  ])
    assert.ok(files.some((f) => f.path === name));
  assert.equal(sourceHash(files), sourceHash(files));
  assert.equal(
    files.some((f) => f.path.includes(".local")),
    false,
  );
});
test("engineering delivery saves real files separately, gives authenticated ZIP and does not mark document tasks done", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.start({ confirmed: false })).status, 400);
  assert.equal((await f.start({ revision: 0 })).status, 400);
  assert.equal((await f.start({ revision: 99 })).status, 409);
  const started = await f.start();
  assert.equal(started.status, 200);
  const b = await f.settled(started.body.id);
  assert.equal(b.status, "verified");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].max_tokens, 8192);
  assert.ok(b.files.length > 12);
  assert.equal(
    b.files.some((x) => "content" in x),
    false,
  );
  assert.equal(b.stale, false);
  const file = await f.req(
    `/software-builds/${b.id}/file?path=server%2Fapp.mjs`,
  );
  assert.match(file.body.content, /DatabaseSync/);
  assert.equal(
    (await f.req(`/software-builds/${b.id}/file?path=..%2Fai-config.json`))
      .status,
    404,
  );
  const download = await fetch(
    f.base + `/api/software-builds/${b.id}/download`,
  );
  assert.equal(download.headers.get("content-type"), "application/zip");
  const zip = Buffer.from(await download.arrayBuffer());
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.ok(zip.includes(Buffer.from("verification-report.json")));
  assert.equal(zip.includes(Buffer.from("test-only-secret")), false);
  const denied = await fetch(f.base + `/api/software-builds/${b.id}/download`, {
    headers: { origin: "https://untrusted.invalid" },
  });
  assert.equal(denied.status, 403);
  const snap = (await f.req("/workspace")).body;
  assert.equal(snap.revision, 1);
  assert.deepEqual(snap.state.tasks, f.state.tasks);
  assert.equal((await f.req("/runs")).body[0].kind, "software-generate");
  snap.state.projects[0].goal += "新增业务规则";
  await f.req("/workspace", snap, "PUT");
  assert.equal((await f.req(`/software-builds/${b.id}`)).body.stale, true);
  await f.reboot();
  assert.equal(
    (await f.req(`/software-builds/${b.id}`)).body.status,
    "verified",
  );
});
test("real validation failure feeds repair and obeys call cap; unavailable environment does not repair", async (t) => {
  const f = await fixture(t);
  let attempt = 0;
  f.verify(async () =>
    ++attempt === 1
      ? {
          passed: false,
          checks: [{ name: "build", passed: false, detail: "syntax" }],
          logs: "actual test error fixture",
        }
      : { passed: true, checks: [], logs: "pass" },
  );
  const b = await f.settled((await f.start()).body.id);
  assert.equal(b.status, "verified");
  assert.equal(b.attempts.length, 2);
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[1].messages[1].content, /actual test error fixture/);
  f.verify(async () => ({
    passed: false,
    unavailable: true,
    checks: [],
    logs: "no sandbox",
  }));
  const no = await f.settled((await f.start({ maxRepairs: 2 })).body.id);
  assert.equal(no.status, "failed");
  assert.equal(no.attempts.length, 1);
  assert.equal(no.baseBuildId, b.id);
  assert.match(f.calls[2].messages[1].content, /上一版源码/);
  assert.match(f.calls[2].messages[1].content, /DatabaseSync/);
  assert.ok(no.files.length);
  assert.match(no.error, /未运行验证/);
  f.respond(() => "# planning is not a project");
  const bad = await f.settled((await f.start({ maxRepairs: 1 })).body.id);
  assert.equal(bad.status, "failed");
  assert.equal(bad.files.length, 0);
  assert.equal(bad.attempts.length, 2);
  assert.equal(
    (await f.req(`/software-builds/${bad.id}/download`)).status,
    400,
  );
});
test("active engineering locks same-project requirements, rejects duplicate/doc jobs and can cancel without residual success", async (t) => {
  const f = await fixture(t);
  f.respond(() => "hold");
  const b = (await f.start()).body;
  await until(() => f.calls.length);
  assert.equal((await f.start()).status, 409);
  assert.equal(
    (
      await f.req(`/automation/${f.id}/start`, {
        confirmed: true,
        revision: 1,
        mode: "auto",
        maxCalls: 2,
        maxReworks: 0,
      })
    ).status,
    409,
  );
  const snap = (await f.req("/workspace")).body;
  snap.state.projects[0].goal += " changed";
  assert.equal((await f.req("/workspace", snap, "PUT")).status, 423);
  const active = (await f.req("/automations")).body[0];
  assert.equal(active.kind, "software");
  assert.equal(active.id, b.id);
  await f.req(`/software-builds/${b.id}/cancel`, {});
  assert.equal((await f.settled(b.id)).status, "cancelled");
  assert.equal((await f.req("/automations")).body.length, 0);
  assert.equal(
    (
      await f.req(`/automation/${f.id}/start`, {
        confirmed: true,
        revision: 1,
        mode: "auto",
        maxCalls: 2,
        maxReworks: 0,
      })
    ).status,
    400,
  );
});
test("cancel during verification preserves sources but never claims success; restart interrupts without spending", async (t) => {
  const f = await fixture(t);
  let validating = false;
  f.verify(async (_files, { signal }) => {
    validating = true;
    await new Promise((r) =>
      signal.addEventListener("abort", r, { once: true }),
    );
    signal.throwIfAborted();
  });
  const b = (await f.start()).body;
  await until(() => validating);
  await f.req(`/software-builds/${b.id}/cancel`, {});
  const cancelled = await f.settled(b.id);
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.files.length);
  assert.equal(cancelled.validation, null);
  f.respond(() => "hold");
  const running = (await f.start()).body;
  await until(() => f.calls.length === 2);
  await f.reboot();
  assert.equal(
    (await f.req(`/software-builds/${running.id}`)).body.status,
    "interrupted",
  );
  assert.equal(f.calls.length, 2);
});
test("engineering history is bounded and templates retain delivery type", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-build-retain-"));
  const db = openDatabase(dir);
  t.after(async () => {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  for (let i = 0; i < 40; i++)
    db.saveBuild({
      id: String(i),
      projectId: "p" + Math.floor(i / 7),
      status: "failed",
    });
  assert.ok(db.listBuilds().length <= 30);
  assert.equal(db.listBuilds("p0").length, 5);
  const s = seedWorkspace(),
    p = { ...s.projects[0], deliveryType: "software" };
  const template = projectToTemplate(p, s.tasks, "website flow");
  assert.equal(
    instantiateTemplate(template, s, "website").project.deliveryType,
    "software",
  );
});

test("revalidate uses no model or key, creates a linked version and preserves old requirement provenance", async (t) => {
  const f = await fixture(t);
  f.verify(async () => ({
    passed: false,
    unavailable: true,
    checks: [],
    logs: "environment unavailable",
  }));
  const original = await f.settled((await f.start()).body.id);
  const firstSource = (
    await f.req(`/software-builds/${original.id}/file?path=server%2Fapp.mjs`)
  ).body.content;
  const snapshot = (await f.req("/workspace")).body;
  snapshot.state.projects[0].goal += " new goal";
  await f.req("/workspace", snapshot, "PUT");
  await fs.writeFile(
    path.join(f.dir, "ai-config.json"),
    JSON.stringify({ apiKey: "" }),
  );
  f.verify(async () => ({
    passed: true,
    checks: [],
    logs: "restored environment",
  }));
  const options = { confirmed: true, allowSandbox: true, revision: 2 };
  assert.equal(
    (
      await f.req(`/software-builds/${original.id}/revalidate`, {
        ...options,
        confirmed: false,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.req(`/software-builds/${original.id}/revalidate`, {
        ...options,
        revision: 1,
      })
    ).status,
    409,
  );
  const response = await f.req(
    `/software-builds/${original.id}/revalidate`,
    options,
  );
  assert.equal(response.status, 200);
  const checked = await f.settled(response.body.id);
  assert.equal(checked.status, "verified");
  assert.equal(checked.mode, "validate");
  assert.equal(checked.attempt, 0);
  assert.equal(checked.baseBuildId, original.id);
  assert.equal(checked.requirementsHash, original.requirementsHash);
  assert.equal(checked.stale, true);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.req("/runs")).body.length, 1);
  assert.equal(
    (await f.req(`/software-builds/${checked.id}/file?path=server%2Fapp.mjs`))
      .body.content,
    firstSource,
  );
  assert.equal(
    (await f.req(`/software-builds/${original.id}`)).body.status,
    "failed",
  );
  assert.equal(checked.sourceHash, original.sourceHash);
  assert.equal(checked.attempts.length, 1);
  assert.equal(typeof checked.validation.durationMs, "number");
});
test("revalidation locks current requirements, rejects concurrent downloads/jobs, and cancels cleanly", async (t) => {
  const f = await fixture(t);
  const original = await f.settled((await f.start()).body.id);
  const snap = (await f.req("/workspace")).body;
  snap.state.projects[0].goal += " new requirements";
  await f.req("/workspace", snap, "PUT");
  let entered = false;
  f.verify(async (_files, { signal }) => {
    entered = true;
    await new Promise((r) =>
      signal.addEventListener("abort", r, { once: true }),
    );
    signal.throwIfAborted();
  });
  const options = { confirmed: true, allowSandbox: true, revision: 2 };
  const response = await f.req(
    `/software-builds/${original.id}/revalidate`,
    options,
  );
  await until(() => entered);
  assert.equal(
    (await f.req(`/software-builds/${original.id}/revalidate`, options)).status,
    409,
  );
  assert.equal((await f.start()).status, 409);
  assert.equal(
    (await f.req(`/software-builds/${response.body.id}/download`)).status,
    409,
  );
  const current = (await f.req("/workspace")).body;
  current.state.profile.name = "Safe unrelated edit";
  assert.equal((await f.req("/workspace", current, "PUT")).status, 200);
  const blocked = (await f.req("/workspace")).body;
  blocked.state.projects[0].goal += " blocked";
  assert.equal((await f.req("/workspace", blocked, "PUT")).status, 423);
  await f.req(`/software-builds/${response.body.id}/cancel`, {});
  assert.equal((await f.settled(response.body.id)).status, "cancelled");
  assert.equal(f.calls.length, 1);
});
test("generation chooses stable base explicitly, can start fresh and rejects foreign or missing bases", async (t) => {
  const f = await fixture(t);
  const stable = await f.settled((await f.start()).body.id);
  f.verify(async () => ({ passed: false, checks: [], logs: "fixture failed" }));
  const broken = await f.settled((await f.start({ maxRepairs: 0 })).body.id);
  const next = await f.settled((await f.start({ maxRepairs: 0 })).body.id);
  assert.equal(next.baseBuildId, stable.id);
  const explicit = await f.settled(
    (await f.start({ maxRepairs: 0, baseBuildId: broken.id })).body.id,
  );
  assert.equal(explicit.baseBuildId, broken.id);
  const fresh = await f.settled(
    (await f.start({ maxRepairs: 0, baseBuildId: null })).body.id,
  );
  assert.equal(fresh.baseBuildId, null);
  assert.doesNotMatch(f.calls.at(-1).messages[1].content, /上一版源码/);
  assert.equal(
    (await f.start({ baseBuildId: "00000000-0000-4000-8000-000000000000" }))
      .status,
    404,
  );
  const snap = (await f.req("/workspace")).body;
  snap.state.projects.push({
    ...snap.state.projects[0],
    id: "another-project",
  });
  await f.req("/workspace", snap, "PUT");
  const foreign = await f.req("/software/another-project/start", {
    confirmed: true,
    allowSandbox: true,
    revision: 2,
    maxRepairs: 0,
    baseBuildId: fresh.id,
  });
  assert.equal(foreign.status, 400);
  assert.equal(f.calls.length, 5);
});
test("full requirement tails are supplied and changes after 5000 characters invalidate old builds", async (t) => {
  const f = await fixture(t);
  let snap = (await f.req("/workspace")).body;
  snap.state.tasks[0].result = "a".repeat(6000) + "TAIL_REQUIREMENT";
  await f.req("/workspace", snap, "PUT");
  const build = await f.settled((await f.start()).body.id);
  assert.equal(build.stale, false);
  assert.match(f.calls[0].messages[1].content, /TAIL_REQUIREMENT/);
  snap = (await f.req("/workspace")).body;
  snap.state.tasks[0].result += " changed";
  await f.req("/workspace", snap, "PUT");
  assert.equal((await f.req(`/software-builds/${build.id}`)).body.stale, true);
  snap = (await f.req("/workspace")).body;
  snap.state.tasks[0].result = "字".repeat(90000);
  assert.equal((await f.req("/workspace", snap, "PUT")).status, 200);
  assert.equal((await f.start()).status, 400);
  assert.equal(f.calls.length, 1);
});
