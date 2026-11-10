import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/index.mjs";
import { openDatabase } from "../server/database.mjs";
import { seedWorkspace } from "../src/domain.ts";
import {
  assembleBundle,
  sourceHash,
  sourceFiles,
} from "../server/project-bundle.mjs";
import { fullstackFixture } from "./fixtures/fullstack.mjs";
import { requirements, requirementsHash } from "../server/requirements.mjs";
import {
  encodeFullBackup,
  decodeFullBackup,
  backupDigest,
} from "../server/full-backup.mjs";
import { lanAddresses } from "../server/access.mjs";
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-full-backup-"));
  const state = seedWorkspace();
  state.profile.name = "完整备份回归";
  const db = openDatabase(dir);
  db.save(state, 0);
  db.snapshot("测试快照");
  const files = await assembleBundle(fullstackFixture());
  const build = {
    id: randomUUID(),
    projectId: state.projects[0].id,
    title: "测试网站",
    startedAt: new Date().toISOString(),
    status: "verified",
    files,
    sourceHash: sourceHash(files),
    requirementsHash: requirementsHash(
      requirements(state, state.projects[0].id),
    ),
    requirementsVersion: 2,
    summary: "网站",
    attempts: [],
    pinned: true,
    validation: { passed: true, checks: [], logs: "历史通过" },
  };
  build.sourceOrigin = {
    id: build.id,
    sequence: 7,
    startedAt: build.startedAt,
  };
  db.saveBuild(build);
  db.saveRun({
    id: randomUUID(),
    status: "succeeded",
    kind: "test",
    label: "模拟执行记录",
    startedAt: new Date().toISOString(),
    sources: [],
    output: { content: "保留日志正文" },
  });
  db.saveAutomation({
    id: randomUUID(),
    projectId: state.projects[0].id,
    status: "paused",
    mode: "auto",
    taskIds: [state.tasks[0].id],
    usedCalls: 2,
    maxCalls: 10,
    maxReworks: 1,
    events: [],
  });
  const initial = db.dump();
  db.close();
  const configPath = path.join(dir, "ai-config.json");
  const credentials = JSON.stringify({
    apiKey: "DO-NOT-EXPORT",
    provider: "mock",
    model: "fixture",
    baseUrl: "http://127.0.0.1:1",
  });
  await fs.writeFile(configPath, credentials, { mode: 0o600 });
  const app = createApp({ shared: true, lan: true, configPath });
  const server = app.listen(0, "0.0.0.0");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (route, body, headers = {}) => {
    const binary = Buffer.isBuffer(body);
    return fetch(
      (headers.host ? `http://${headers.host}` : base) + "/api" + route,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(body === undefined
            ? {}
            : {
                "Content-Type": binary
                  ? "application/gzip"
                  : "application/json",
              }),
          ...headers,
        },
        body:
          body === undefined ? undefined : binary ? body : JSON.stringify(body),
      },
    );
  };
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await app.locals.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    state,
    build,
    files,
    initial,
    req,
    base,
    configPath,
    credentials,
  };
}
test("complete archive round-trip restores source/logs/jobs/snapshots into an empty database without executing code", async (t) => {
  const f = await fixture(t);
  const response = await f.req("/full-backup");
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(gunzipSync(bytes).toString().includes("DO-NOT-EXPORT"), false);
  const decoded = await decodeFullBackup(bytes);
  assert.deepEqual(decoded.counts, {
    projects: 3,
    tasks: f.state.tasks.length,
    knowledge: f.initial.workspace.state.knowledge.length,
    templates: 0,
    builds: 1,
    runs: 1,
    automations: 1,
    snapshots: 1,
  });
  const target = await fs.mkdtemp(
    path.join(os.tmpdir(), "ark-restore-target-"),
  );
  const db = openDatabase(target);
  t.after(async () => {
    db.close();
    await fs.rm(target, { recursive: true, force: true });
  });
  const restored = db.restore(decoded.data, 0);
  assert.equal(restored.revision, 1);
  assert.equal(restored.state.profile.name, f.state.profile.name);
  assert.equal(db.getBuild(f.build.id).status, "restored");
  assert.equal(db.getBuild(f.build.id).validation, null);
  assert.deepEqual(db.getBuild(f.build.id).sourceOrigin, f.build.sourceOrigin);
  assert.deepEqual(
    sourceFiles(db.getBuild(f.build.id).files),
    sourceFiles(f.files),
  );
  assert.equal(db.listRuns()[0].output.content, "保留日志正文");
  assert.equal(db.listAutomations()[0].usedCalls, 2);
  assert.equal(db.backups().length, 1);
});
test("preview is read-only; confirmed restore makes an independent safety archive, reloads jobs, preserves credentials and invalidates old revisions", async (t) => {
  const f = await fixture(t);
  const bytes = Buffer.from(await (await f.req("/full-backup")).arrayBuffer());
  const before = await (await f.req("/workspace")).json();
  let response = await f.req("/full-backup/preview", bytes);
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(
    (await (await f.req("/workspace")).json()).revision,
    before.revision,
  );
  assert.equal(
    (
      await f.req("/full-backup/restore", {
        token: preview.token,
        revision: before.revision,
        confirmed: false,
      })
    ).status,
    400,
  );
  response = await f.req("/full-backup/restore", {
    token: preview.token,
    revision: before.revision,
    confirmed: true,
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  const safety = path.join(f.dir, "full-backups", result.safetyBackup);
  assert.equal((await fs.stat(safety)).mode & 0o777, 0o600);
  assert.equal(
    (await decodeFullBackup(await fs.readFile(safety))).counts.builds,
    1,
  );
  assert.equal(await fs.readFile(f.configPath, "utf8"), f.credentials);
  assert.equal(
    (await (await f.req("/workspace")).json()).revision,
    before.revision + 1,
  );
  assert.equal(
    (await (await f.req(`/automation/${f.state.projects[0].id}`)).json()).job
      .status,
    "paused",
  );
  assert.equal((await (await f.req("/automations")).json()).length, 0);
  assert.equal(
    (await (await f.req(`/software-builds/${f.build.id}`)).json()).status,
    "restored",
  );
  assert.equal(
    (
      await f.req("/full-backup/restore", {
        token: preview.token,
        revision: before.revision + 1,
        confirmed: true,
      })
    ).status,
    400,
  );
});
test("corrupt archives, unsafe source paths, duplicate IDs and stale previews never change data", async (t) => {
  const f = await fixture(t),
    bytes = encodeFullBackup(f.initial);
  const before = await (await f.req("/workspace")).json();
  const tampered = JSON.parse(gunzipSync(bytes));
  tampered.data.workspace.state.profile.name = "篡改";
  for (const invalid of [
    Buffer.from("bad"),
    gzipSync(JSON.stringify(tampered)),
  ])
    assert.equal((await f.req("/full-backup/preview", invalid)).status, 400);
  for (const change of [
    (data) =>
      data.builds[0].files.push({ path: "../escape.mjs", content: "x" }),
    (data) => data.runs.push(data.runs[0]),
  ]) {
    const data = structuredClone(f.initial);
    change(data);
    assert.equal(
      (await f.req("/full-backup/preview", encodeFullBackup(data))).status,
      400,
    );
  }
  const preview = await (await f.req("/full-backup/preview", bytes)).json();
  await f.req("/backups", {});
  assert.equal(
    (
      await f.req("/full-backup/restore", {
        token: preview.token,
        revision: before.revision,
        confirmed: true,
      })
    ).status,
    409,
  );
  assert.deepEqual(await (await f.req("/workspace")).json(), before);
});
test("atomic restore rolls back every table if a later insert fails", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-restore-atomic-"));
  const db = openDatabase(dir);
  t.after(async () => {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  db.save(seedWorkspace(), 0);
  db.saveRun({
    id: "a",
    status: "succeeded",
    startedAt: new Date().toISOString(),
  });
  const before = db.dump(),
    bad = structuredClone(before);
  bad.workspace.state.profile.name = "must roll back";
  bad.runs.push(bad.runs[0]);
  assert.throws(() => db.restore(bad, 1));
  assert.deepEqual(db.dump(), before);
});
test("restored platform scripts are regenerated locally and active records are paused rather than resumed", async (t) => {
  const f = await fixture(t),
    data = structuredClone(f.initial);
  data.builds[0].files.find((f) => f.path === "scripts/verify.mjs").content =
    "DO NOT EXECUTE IMPORTED HARNESS";
  data.builds[0].status = "generating";
  data.runs[0].status = "running";
  data.automations[0].status = "running";
  const decoded = await decodeFullBackup(encodeFullBackup(data));
  assert.notEqual(
    decoded.data.builds[0].files.find((f) => f.path === "scripts/verify.mjs")
      .content,
    "DO NOT EXECUTE IMPORTED HARNESS",
  );
  assert.equal(decoded.data.runs[0].status, "cancelled");
  assert.equal(decoded.data.automations[0].status, "paused");
  assert.equal(decoded.data.builds[0].status, "restored");
});
test("paired mobile cannot download/preview/restore full archives; restore revokes its old session", async (t) => {
  const f = await fixture(t),
    address = lanAddresses()[0]?.address;
  if (!address) return t.skip("No LAN interface");
  const code = await (await f.req("/connection/code", {})).json();
  const headers = { host: `${address}:${new URL(f.base).port}` };
  const paired = await f.req("/pair", { code: code.code }, headers);
  assert.equal(paired.status, 200);
  headers.cookie = paired.headers.get("set-cookie").split(";")[0];
  for (const [route, body] of [
    ["/full-backup", undefined],
    ["/full-backup/preview", Buffer.from("x")],
    ["/full-backup/restore", {}],
  ])
    assert.equal((await f.req(route, body, headers)).status, 403);
  const bytes = Buffer.from(await (await f.req("/full-backup")).arrayBuffer());
  const preview = await (await f.req("/full-backup/preview", bytes)).json();
  assert.equal(
    (
      await f.req("/full-backup/restore", {
        token: preview.token,
        revision: 1,
        confirmed: true,
      })
    ).status,
    200,
  );
  assert.equal((await f.req("/workspace", undefined, headers)).status, 401);
});

test("failure to write pre-restore safety backup leaves all current tables intact", async (t) => {
  const f = await fixture(t),
    bytes = Buffer.from(await (await f.req("/full-backup")).arrayBuffer());
  const preview = await (await f.req("/full-backup/preview", bytes)).json();
  const before = await (await f.req("/workspace")).json();
  await fs.writeFile(
    path.join(f.dir, "full-backups"),
    "simulate a blocked directory",
  );
  const response = await f.req("/full-backup/restore", {
    token: preview.token,
    revision: before.revision,
    confirmed: true,
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await (await f.req("/workspace")).json(), before);
  assert.equal(
    (await (await f.req(`/software-builds/${f.build.id}`)).json()).status,
    "verified",
  );
});

test("active AI work blocks preview and restore, while export retains a consistent snapshot", async (t) => {
  const f = await fixture(t),
    bytes = Buffer.from(await (await f.req("/full-backup")).arrayBuffer());
  const preview = await (await f.req("/full-backup/preview", bytes)).json();
  const raw = new DatabaseSync(path.join(f.dir, "workspace.sqlite"));
  raw.prepare("INSERT INTO runs VALUES (?, ?)").run(
    "running-fixture",
    JSON.stringify({
      id: "running-fixture",
      status: "running",
      startedAt: new Date().toISOString(),
    }),
  );
  raw.close();
  assert.equal((await f.req("/full-backup/preview", bytes)).status, 409);
  assert.equal(
    (
      await f.req("/full-backup/restore", {
        token: preview.token,
        revision: 1,
        confirmed: true,
      })
    ).status,
    409,
  );
  assert.equal((await f.req("/full-backup")).status, 200);
  assert.equal(
    (await (await f.req(`/software-builds/${f.build.id}`)).json()).status,
    "verified",
  );
});
