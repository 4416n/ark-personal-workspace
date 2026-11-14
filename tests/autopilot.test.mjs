import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/index.mjs";
import { automaticReleaseGate } from "../server/autopilot.mjs";
import { releaseManager } from "../server/release-manager.mjs";
import { sourceHash } from "../server/project-bundle.mjs";
import { seedWorkspace } from "../src/domain.ts";
import { stagedResponse } from "./fixtures/staged.mjs";
import { waitForHttp } from "./helpers/http.mjs";
import { removeTestDirectory } from "./helpers/filesystem.mjs";
import { VERIFICATION_VERSION } from "../server/scaffold/scripts/persistence.mjs";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function until(action) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const result = await action();
    if (result) return result;
    await wait(10);
  }
  throw new Error("automatic workflow timed out");
}

function mockRuntime() {
  const calls = [], containers = new Map();
  const api = {
    calls, containers,
    available: true, failBuild: false, failHealth: false, failingImages: new Set(),
    capability: async () => ({ available: api.available, reason: api.available ? "mock Docker" : "Docker missing" }),
    validate: async () => ({ passed: true, verificationVersion: VERIFICATION_VERSION, checks: [{ name: "动态与浏览器检查", passed: true, detail: "mock only" }], coverage: { browser: true, update: true, remove: true }, logs: "mock" }),
    buildImage: async (_files, image) => { calls.push(["build", image]); if (api.failBuild) throw new Error("image build failed"); },
    network: async (name) => calls.push(["network", name]),
    createVolume: async (name, _image, from) => calls.push(["copy-data", name, from]),
    startContainer: async (options) => { calls.push(["launch", options.name]); containers.set(options.name, { running: true, image: options.image }); return "http://127.0.0.1:8800"; },
    health: async (url) => { calls.push(["health", url]); if (api.failHealth) throw new Error("health failed"); },
    removeContainer: async (name) => { calls.push(["remove", name]); containers.delete(name); },
    command: async (args) => {
      calls.push(args);
      const [action, name] = args;
      if (action === "stop" || action === "start") {
        const containerName = args.at(-1);
        const container = containers.get(containerName);
        if (container) container.running = action === "start";
      }
      if (action === "inspect") {
        const container = containers.get(name);
        return JSON.stringify([{ State: { Running: !!container?.running && !api.failingImages.has(container.image) } }]);
      }
      return "";
    },
  };
  return api;
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-autopilot-test-"));
  const runtime = mockRuntime();
  let respond = (body) => {
    if (body.messages[0].content.includes("全自动网站交付规划师")) return JSON.stringify({ tasks: [{ title: "新增和读取笔记", description: "用SQLite持久化笔记", deliverable: "笔记网站", acceptanceCriteria: ["新增后能刷新读回"], executionMode: "ai", skills: ["开发"], priority: "high", estimatedHours: 2, dependsOn: [] }] });
    return stagedResponse(body);
  };
  const calls = [];
  const upstream = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); calls.push(body);
    const content = await respond(body);
    if (content === "HOLD") return;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  }).listen(0, "127.0.0.1");
  await waitForHttp(upstream);
  let app, server, base;
  async function boot() {
    app = createApp({ shared: true, configPath: path.join(directory, "ai-config.json"), autopilotOptions: { runtime, releaseOptions: { monitorMs: 600000, fetcher: async () => ({ status: 200 }) }, jobOptions: { pollMs: 20, retryDelayMs: 10 } } });
    server = app.listen(0, "127.0.0.1"); await waitForHttp(server);
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    await app.locals.close();
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  }
  const request = async (route, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(base + "/api" + route, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  await boot();
  await request("/workspace", { revision: 0, state: seedWorkspace() }, "PUT");
  await request("/config", { provider: "mock", model: "mock", apiKey: "TEST-ONLY", baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });
  t.after(async () => { await stop(); upstream.closeAllConnections(); await new Promise((resolve) => upstream.close(resolve)); await removeTestDirectory(directory); });
  return {
    runtime, calls, request,
    setRespond: (fn) => respond = fn,
    restart: async () => { await stop(); await boot(); },
    start: (extra = {}) => request("/autopilot/start", { revision: 1, title: "全自动笔记", goal: "开发支持新增和持久化读取的笔记应用", maxRepairs: 1, maxRecoveryAttempts: 1, ...extra }),
    finished: () => until(async () => { const data = (await request("/autopilot")).data; const job = data.jobs[0]; return job && ["succeeded", "failed", "cancelled"].includes(job.status) ? { ...data, job } : null; }),
  };
}

test("one request plans, generates, verifies, deploys and records machine evidence without human approval", async (t) => {
  const f = await fixture(t);
  const started = await f.start();
  assert.equal(started.status, 200);
  const result = await f.finished();
  assert.equal(result.job.status, "succeeded", result.job.error);
  assert.equal(result.job.machineAcceptance.actor, "automation");
  assert.equal(result.releases[0].status, "live");
  assert.ok(result.job.url.includes("127.0.0.1"));
  const workspace = (await f.request("/workspace")).data;
  assert.equal(workspace.state.projects.filter((item) => item.id === result.job.projectId).length, 1);
  assert.equal(workspace.state.tasks.filter((item) => item.projectId === result.job.projectId).length, 1);
  const build = (await f.request(`/software-builds/${result.job.buildId}`)).data;
  assert.equal(build.validation.driver, undefined);
  assert.equal(build.autonomous, true);
  assert.equal(build.acceptance.complete, false);
  assert.ok(build.acceptance.items.every((item) => item.decision === null));
  assert.equal(f.calls.length, 6);
  await f.restart();
  await wait(100);
  assert.equal(f.calls.length, 6, "completed jobs must not restart after service restart");
});

test("Docker preflight refuses execution before creating projects or spending model calls", async (t) => {
  const f = await fixture(t);
  f.runtime.available = false;
  const response = await f.start();
  assert.equal(response.status, 503);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request("/autopilot")).data.jobs.length, 0);
});

test("automatic recovery resumes a failed stage without repeating completed model stages", async (t) => {
  const f = await fixture(t);
  let failedBackend = 0;
  f.setRespond((body) => {
    if (body.messages[0].content.includes("全自动网站交付规划师")) return JSON.stringify({ tasks: [{ title: "笔记", description: "新增并保存笔记", skills: ["开发"] }] });
    const id = /^本次阶段：(\w+)/.exec(body.messages.at(-1).content)?.[1];
    if (id === "backend" && failedBackend++ < 1) return "invalid-json";
    return stagedResponse(body);
  });
  await f.start({ maxRepairs: 0 });
  const { job } = await f.finished();
  assert.equal(job.status, "succeeded", job.error);
  assert.equal(job.recoveries, 1);
  assert.equal(f.calls.filter((body) => body.messages.at(-1).content.startsWith("本次阶段：contract")).length, 1);
  assert.equal(f.calls.filter((body) => body.messages.at(-1).content.startsWith("本次阶段：backend")).length, 2);
});

test("service restart continues an authorized checkpoint", async (t) => {
  const f = await fixture(t);
  let hold = true;
  f.setRespond((body) => {
    if (body.messages[0].content.includes("全自动网站交付规划师")) return JSON.stringify({ tasks: [{ title: "笔记", description: "保存笔记", skills: ["开发"] }] });
    const id = /^本次阶段：(\w+)/.exec(body.messages.at(-1).content)?.[1];
    if (id === "frontend" && hold) return "HOLD";
    return stagedResponse(body);
  });
  await f.start();
  await until(() => f.calls.some((body) => body.messages.at(-1).content.startsWith("本次阶段：frontend")));
  hold = false;
  await f.restart();
  const { job } = await f.finished();
  assert.equal(job.status, "succeeded", job.error);
  assert.equal(f.calls.filter((body) => body.messages.at(-1).content.startsWith("本次阶段：backend")).length, 1);
});

test("explicit stop cancels active generation and never resumes it after restart", async (t) => {
  const f = await fixture(t);
  f.setRespond((body) => {
    if (body.messages[0].content.includes("全自动网站交付规划师")) return JSON.stringify({ tasks: [{ title: "笔记", description: "保存笔记", skills: ["开发"] }] });
    if (body.messages.at(-1).content.startsWith("本次阶段：frontend")) return "HOLD";
    return stagedResponse(body);
  });
  const started = await f.start();
  await until(() => f.calls.some((body) => body.messages.at(-1).content.startsWith("本次阶段：frontend")));
  const snapshot = (await f.request("/workspace")).data;
  const changed = structuredClone(snapshot.state);
  changed.projects.find((project) => project.id === started.data.projectId).goal += "修改";
  assert.equal((await f.request("/workspace", { revision: snapshot.revision, state: changed }, "PUT")).status, 423);
  assert.equal((await f.request("/autopilot/start", { revision: snapshot.revision, title: "重复", goal: "重复启动目标" })).status, 409);
  assert.equal((await f.request(`/software/${started.data.projectId}/start`, {})).status, 409);
  await f.request(`/autopilot/${started.data.id}/stop`, {});
  assert.equal((await f.finished()).job.status, "cancelled");
  const calls = f.calls.length;
  await f.restart(); await wait(100);
  assert.equal(f.calls.length, calls);
  assert.equal((await f.request("/autopilot")).data.jobs[0].status, "cancelled");
});

test("failed verification exhausts bounded repair/recovery and never deploys", async (t) => {
  const f = await fixture(t);
  f.runtime.validate = async () => ({ passed: false, verificationVersion: VERIFICATION_VERSION, checks: [{ name: "未通过", passed: false, detail: "test" }], logs: "broken" });
  await f.start({ maxRepairs: 0, maxRecoveryAttempts: 0 });
  const result = await f.finished();
  assert.equal(result.job.status, "failed");
  assert.equal(result.releases.length, 0);
  assert.equal(f.runtime.calls.length, 0);
});

test("unresolved requirements cannot silently pass the automatic release gate", () => {
  const build = { status: "verified", sourceHash: "hash", requirementsHash: "requirements", validation: { passed: true, verificationVersion: VERIFICATION_VERSION, sourceHash: "hash", coverage: { browser: true } }, pipeline: { next: null }, acceptance: { sourceHash: "hash", requirementsHash: "requirements", items: [{ criterion: "真实支付", requiresHuman: true, recommendation: "manual", files: [], checks: [] }] } };
  assert.throws(() => automaticReleaseGate(build), /自动发布门禁/);
  build.acceptance.items[0] = { criterion: "新增笔记", requiresHuman: false, recommendation: "supported", files: [{ path: "server/app.mjs" }], checks: [{ passed: true }] };
  assert.equal(automaticReleaseGate(build).actor, "automation");
  build.validation.coverage.browser = false;
  assert.throws(() => automaticReleaseGate(build), /真实隔离测试/);
});

test("deployment copies consistent data, restores the old version on failure and rolls back unhealthy releases", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-release-test-"));
  const runtime = mockRuntime();
  const manager = releaseManager({ directory, runtime, monitorMs: 600000, fetcher: async () => ({ status: 200 }) });
  t.after(async () => { manager.close(); await removeTestDirectory(directory); });
  const build = (version) => {
    const files = [{ path: "tests/acceptance.json", content: JSON.stringify({ persistence: { read: { path: "/api/notes", status: 200 } } }) }, { path: "README.md", content: version }];
    const hash = sourceHash(files);
    return { id: version, files, sourceHash: hash, validation: { passed: true, sourceHash: hash } };
  };
  const first = await manager.deploy("project", build("v1"));
  assert.equal(first.status, "live");
  const second = await manager.deploy("project", build("v2"));
  assert.equal(second.previous.buildId, "v1");
  assert.ok(runtime.calls.some((call) => call[0] === "copy-data" && call[2] === first.current.volume));
  runtime.failBuild = true;
  await assert.rejects(manager.deploy("project", build("v3")), /image build failed/);
  assert.equal(manager.list()[0].current.buildId, "v2");
  assert.equal(manager.list()[0].status, "rolled-back");
  runtime.failBuild = false;
  runtime.failingImages.add(second.current.image);
  await manager.monitor(); await manager.monitor(); await manager.monitor();
  assert.equal(manager.list()[0].current.buildId, "v1");
  assert.equal(manager.list()[0].status, "rolled-back");
  assert.equal(manager.list()[0].failed.buildId, "v2");
  assert.ok(manager.list()[0].archived.some((release) => release.buildId === "v3"));
});

test("restart recovers a persisted partial deployment before accepting new release work", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-release-recovery-"));
  const runtime = mockRuntime();
  const previous = { id: "old", buildId: "old", sourceHash: "old", container: "ark-auto-old", image: "ark-auto-old", localUrl: "http://127.0.0.1:8800", volume: "ark-auto-old" };
  runtime.containers.set(previous.container, { running: false, image: previous.image });
  await fs.writeFile(path.join(directory, "autopilot-releases.json"), JSON.stringify({ version: 1, apps: [{ projectId: "project", port: 8800, status: "checking", current: previous, pending: { container: "ark-auto-interrupted" }, previous: null, events: [] }] }));
  const manager = releaseManager({ directory, runtime, monitorMs: 600000 });
  t.after(async () => { manager.close(); await removeTestDirectory(directory); });
  await manager.recover();
  const app = manager.list()[0];
  assert.equal(app.pending, null);
  assert.equal(app.status, "rolled-back");
  assert.equal(runtime.containers.get(previous.container).running, true);
  assert.ok(runtime.calls.some((call) => call[0] === "remove" && call[1] === "ark-auto-interrupted"));
  assert.equal(app.failed.container, "ark-auto-interrupted");
});

test("restart restores the current version after a failed rollout recovery, not an older previous version", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-release-restore-current-"));
  const runtime = mockRuntime();
  const current = { id: "current", container: "ark-auto-current", image: "ark-auto-current", localUrl: "http://127.0.0.1:8800" };
  const previous = { id: "previous", container: "ark-auto-previous", image: "ark-auto-previous", localUrl: current.localUrl };
  runtime.containers.set(current.container, { running: false, image: current.image });
  runtime.containers.set(previous.container, { running: false, image: previous.image });
  await fs.writeFile(path.join(directory, "autopilot-releases.json"), JSON.stringify({ version: 1, apps: [{ projectId: "project", port: 8800, status: "rollback-failed", current, previous, pending: { id: "pending", container: "ark-auto-pending", volume: "ark-auto-pending-data" }, events: [] }] }));
  const manager = releaseManager({ directory, runtime, monitorMs: 600000 });
  t.after(async () => { manager.close(); await removeTestDirectory(directory); });
  await manager.recover();
  const app = manager.list()[0];
  assert.equal(app.current.id, "current");
  assert.equal(app.previous.id, "previous");
  assert.equal(app.failed.volume, "ark-auto-pending-data");
  assert.equal(app.pending, null);
  assert.equal(runtime.containers.get(current.container).running, true);
  assert.equal(runtime.containers.get(previous.container).running, false);
});

test("health rollback tolerates a disappeared failed container but retains the previous data version", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-release-missing-container-"));
  const runtime = mockRuntime();
  const current = { id: "missing", container: "ark-auto-missing", image: "ark-auto-missing", localUrl: "http://127.0.0.1:8800" };
  const previous = { id: "working", container: "ark-auto-working", image: "ark-auto-working", localUrl: current.localUrl, volume: "ark-auto-working-data" };
  runtime.containers.set(previous.container, { running: false, image: previous.image });
  const originalCommand = runtime.command;
  runtime.command = async (args, options) => {
    if (args[0] === "stop" && args.at(-1) === current.container) throw new Error("Error: No such container");
    return originalCommand(args, options);
  };
  await fs.writeFile(path.join(directory, "autopilot-releases.json"), JSON.stringify({ version: 1, apps: [{ projectId: "project", port: 8800, status: "live", current, previous, events: [] }] }));
  const manager = releaseManager({ directory, runtime, monitorMs: 600000 });
  t.after(async () => { manager.close(); await removeTestDirectory(directory); });
  await manager.monitor(); await manager.monitor(); await manager.monitor();
  const app = manager.list()[0];
  assert.equal(app.status, "rolled-back");
  assert.equal(app.current.volume, previous.volume);
  assert.equal(app.failed.id, current.id);
  assert.equal(runtime.containers.get(previous.container).running, true);
});

test("a transient rollback failure is retried automatically by health monitoring", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-release-rollback-retry-"));
  const runtime = mockRuntime();
  const current = { id: "bad", container: "ark-auto-bad", image: "ark-auto-bad", localUrl: "http://127.0.0.1:8800" };
  const previous = { id: "good", container: "ark-auto-good", image: "ark-auto-good", localUrl: current.localUrl };
  runtime.containers.set(current.container, { running: true, image: current.image });
  runtime.containers.set(previous.container, { running: false, image: previous.image });
  const originalCommand = runtime.command;
  let startAttempts = 0;
  runtime.command = async (args, options) => {
    if (args[0] === "start" && args.at(-1) === previous.container && startAttempts++ === 0) throw new Error("temporary Docker failure");
    return originalCommand(args, options);
  };
  await fs.writeFile(path.join(directory, "autopilot-releases.json"), JSON.stringify({ version: 1, apps: [{ projectId: "project", port: 8800, status: "live", current, previous, events: [] }] }));
  const manager = releaseManager({ directory, runtime, monitorMs: 600000 });
  t.after(async () => { manager.close(); await removeTestDirectory(directory); });
  await assert.rejects(manager.rollback("project"), /temporary Docker failure/);
  assert.equal(manager.list()[0].status, "rollback-failed");
  await manager.monitor();
  assert.equal(manager.list()[0].status, "rolled-back");
  assert.equal(manager.list()[0].current.id, previous.id);
  assert.equal(startAttempts, 2);
});

test("controller automatically retries startup recovery when Docker becomes available", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-autopilot-startup-retry-"));
  const runtime = mockRuntime();
  await fs.writeFile(path.join(directory, "autopilot-releases.json"), JSON.stringify({ version: 1, apps: [{ projectId: "project", port: 8800, status: "building", current: null, pending: { id: "interrupted", container: "ark-auto-interrupted", volume: "ark-auto-retained-data" }, events: [] }] }));
  let attempts = 0;
  const originalRemove = runtime.removeContainer;
  runtime.removeContainer = async (name) => {
    if (attempts++ === 0) throw new Error("Docker temporarily unavailable");
    return originalRemove(name);
  };
  const app = createApp({ shared: true, configPath: path.join(directory, "ai-config.json"), autopilotOptions: { runtime, recoveryMs: 20, releaseOptions: { monitorMs: 600000 } } });
  const server = app.listen(0, "127.0.0.1"); await waitForHttp(server);
  t.after(async () => { await app.locals.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await removeTestDirectory(directory); });
  const base = `http://127.0.0.1:${server.address().port}`;
  await until(() => attempts >= 2);
  const status = await (await fetch(base + "/api/autopilot/capabilities")).json();
  assert.equal(status.recoveryError, "");
  const { releases } = await (await fetch(base + "/api/autopilot")).json();
  assert.equal(releases[0].pending, null);
  assert.equal(releases[0].failed.volume, "ark-auto-retained-data");
});

test("concurrent start requests create only one job and project", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([f.start(), f.start()]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  await f.finished();
  const workspace = (await f.request("/workspace")).data.state;
  assert.equal(workspace.projects.filter((project) => project.title === "全自动笔记").length, 1);
});
