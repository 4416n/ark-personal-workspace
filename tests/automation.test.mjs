import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/index.mjs";
import { seedWorkspace } from "../src/domain.ts";
import { openDatabase } from "../server/database.mjs";
import { parseReview } from "../server/work-output.mjs";
import { deliveryMarkdown } from "../shared/contract.mjs";
import { recordReview, replaceResult } from "../src/delivery.ts";
import { projectToTemplate, instantiateTemplate } from "../src/templates.ts";

async function until(fn) {
  const end = Date.now() + 8000;
  do {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 20));
  } while (Date.now() < end);
  throw new Error("Timed out");
}
function validReview(pass = true, human = false) {
  return {
    passed: pass,
    requiresHuman: human,
    summary: pass ? "具体内容符合标准" : "请补充内容与证据",
    checks: [0, 1].map((criterionIndex) => ({
      criterionIndex,
      passed: pass,
      evidence: pass ? "交付正文包含完整步骤与使用方式" : "缺少可用正文",
    })),
  };
}
async function fixture(t, count = 2) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-auto-"));
  const calls = [];
  let respond = () => null;
  const upstream = http
    .createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw),
        review = body.messages[0].content.includes("独立的交付审查员");
      const call = { body, review, res };
      calls.push(call);
      const answer = await respond(call);
      if (answer === "hold") return;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          answer?.envelope || {
            choices: [
              {
                message: {
                  content:
                    answer ||
                    (review
                      ? JSON.stringify(validReview())
                      : "# 交付内容\n完整的正文和具体步骤。\n## 使用方式\n按步骤修改使用。\n## 待确认与限制\n未执行外部操作。"),
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
          },
        ),
      );
    })
    .listen(0, "127.0.0.1");
  await new Promise((r) => upstream.once("listening", r));
  let app, server, base;
  async function boot() {
    app = createApp({
      shared: true,
      configPath: path.join(dir, "ai-config.json"),
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  await boot();
  async function req(
    route,
    body,
    method = body === undefined ? "GET" : "POST",
  ) {
    const r = await fetch(base + "/api" + route, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  }
  const state = seedWorkspace();
  state.projects = state.projects.slice(0, 1);
  state.knowledge = [];
  state.tasks = Array.from({ length: count }, (_, i) => ({
    ...state.tasks[i],
    id: `task-${i}`,
    projectId: state.projects[0].id,
    title: `写出第${i + 1}份成果`,
    ownerId: "member-content",
    status: "todo",
    result: "",
    dependsOn: i ? [`task-${i - 1}`] : [],
    deliverable: `交付物${i + 1}.md`,
    acceptanceCriteria: ["有完整正文", "说明使用方式"],
    executionMode: "ai",
  }));
  const projectId = state.projects[0].id;
  await req("/workspace", { revision: 0, state }, "PUT");
  await req("/config", {
    provider: "mock",
    baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
    model: "mock-model",
    apiKey: "test-only-never-real",
  });
  const report = async () => (await req(`/automation/${projectId}`)).body;
  const start = async (options = {}, resume = false) =>
    req(`/automation/${projectId}/${resume ? "resume" : "start"}`, {
      confirmed: true,
      revision: (await report()).revision,
      mode: "auto",
      maxCalls: 30,
      maxReworks: 1,
      ...options,
    });
  const settled = () =>
    until(async () => {
      const r = await report();
      return r.job && !["running", "pausing"].includes(r.job.status) ? r : null;
    });
  async function shutdown() {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    app.locals.close();
  }
  t.after(async () => {
    await shutdown();
    upstream.closeAllConnections();
    await new Promise((r) => upstream.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    state,
    projectId,
    calls,
    req,
    report,
    start,
    settled,
    setResponse: (fn) => {
      respond = fn;
    },
    restart: async () => {
      await shutdown();
      await boot();
    },
  };
}

test("自动执行按依赖交付、独立审查返工，再汇总；版本与 AI 验收可追溯", async (t) => {
  const f = await fixture(t);
  let reviews = 0;
  f.setResponse((c) =>
    c.review ? JSON.stringify(validReview(++reviews !== 1)) : null,
  );
  assert.equal((await f.start()).status, 200);
  const r = await f.settled();
  assert.equal(r.job.status, "completed");
  assert.equal(r.job.usedCalls, 6);
  assert.deepEqual(
    f.calls.map((c) => c.review),
    [false, true, false, true, false, true],
  );
  assert.ok(r.tasks.every((x) => x.status === "done" && x.aiReview.passed));
  assert.equal(r.tasks[0].resultHistory.length, 1);
  assert.equal(r.tasks[0].reviews.length, 2);
  assert.equal(r.tasks[0].reviews[0].actor, "ai");
  assert.ok(
    f.calls[4].body.messages[1].content.includes("完整的正文和具体步骤"),
  );
  assert.ok(f.calls[2].body.messages[1].content.includes("请补充内容与证据"));
  const runs = (await f.req("/runs")).body;
  assert.equal(runs.length, 6);
  assert.ok(runs.every((x) => x.usage.total === 30));
  assert.ok(!JSON.stringify(runs).includes("test-only-never-real"));
  const packet = deliveryMarkdown(r.project, r.tasks);
  assert.match(packet, /交付物1.md/);
  assert.match(packet, /AI通过/);
  const task = replaceResult(r.tasks[0], "人工新正文", "manual", "manual");
  assert.equal(task.aiReview, undefined);
  const template = projectToTemplate(r.project, r.tasks, "复用交付流程");
  const fresh = instantiateTemplate(template, f.state, "下一次");
  assert.deepEqual(fresh.tasks[0].acceptanceCriteria, [
    "有完整正文",
    "说明使用方式",
  ]);
  assert.equal(fresh.tasks[0].aiReview, undefined);
});

test("人工验收模式不会自行解锁后续任务，人工通过后可以恢复", async (t) => {
  const f = await fixture(t);
  await f.start({ mode: "manual" });
  let r = await f.settled();
  assert.equal(r.job.status, "needs_attention");
  assert.equal(f.calls.length, 2);
  assert.equal(r.tasks[0].status, "review");
  assert.equal(r.tasks[0].reviews, undefined);
  assert.equal(r.tasks[1].status, "todo");
  const snap = (await f.req("/workspace")).body;
  snap.state.tasks[0] = recordReview(
    snap.state.tasks[0],
    "approved",
    "人工确认",
  );
  await f.req(
    "/workspace",
    { revision: snap.revision, state: snap.state },
    "PUT",
  );
  await f.start({ mode: "manual" }, true);
  r = await f.settled();
  assert.equal(f.calls.length, 4);
  assert.equal(r.tasks[1].status, "review");
});

test("暂停中断当前请求、锁定执行项目但允许其他数据保存，重复启动不加倍调用", async (t) => {
  const f = await fixture(t);
  f.setResponse(() => "hold");
  await f.start();
  await until(() => f.calls.length === 1);
  const snap = (await f.req("/workspace")).body;
  snap.state.profile.focus = "并行修改个人资料";
  assert.equal(
    (
      await f.req(
        "/workspace",
        { revision: snap.revision, state: snap.state },
        "PUT",
      )
    ).status,
    200,
  );
  const newer = (await f.req("/workspace")).body;
  newer.state.tasks[0].title = "试图覆盖正在执行的任务";
  assert.equal(
    (
      await f.req(
        "/workspace",
        { revision: newer.revision, state: newer.state },
        "PUT",
      )
    ).status,
    423,
  );
  assert.equal((await f.start()).status, 409);
  await f.req(`/automation/${f.projectId}/pause`, {});
  const r = await f.settled();
  assert.equal(r.job.status, "paused");
  assert.equal(r.tasks[0].result, "");
  assert.equal(f.calls.length, 1);
  assert.equal((await f.req("/runs")).body[0].status, "cancelled");
  f.setResponse(() => null);
  await f.start({}, true);
  await f.settled();
  assert.equal(
    (await f.req("/workspace")).body.state.profile.focus,
    "并行修改个人资料",
  );
});

test("总调用上限不会超额；恢复需要明确提高总限额", async (t) => {
  const f = await fixture(t);
  await f.start({ maxCalls: 2 });
  let r = await f.settled();
  assert.equal(f.calls.length, 2);
  assert.equal(r.job.status, "needs_attention");
  assert.equal(r.tasks[0].status, "done");
  assert.equal(r.tasks[1].result, "");
  assert.equal((await f.start({ maxCalls: 2 }, true)).status, 400);
  assert.equal((await f.start({ maxCalls: 4 }, true)).status, 200);
  r = await f.settled();
  assert.equal(r.job.status, "completed");
  assert.equal(f.calls.length, 4);
});

test("持续不通过最多返工一次，恢复不隐式重置返工次数", async (t) => {
  const f = await fixture(t, 1);
  f.setResponse((c) => (c.review ? JSON.stringify(validReview(false)) : null));
  await f.start();
  let r = await f.settled();
  assert.equal(f.calls.length, 4);
  assert.equal(r.tasks[0].status, "review");
  assert.match(r.tasks[0].automationBlock, /返工上限/);
  await f.start({}, true);
  r = await f.settled();
  assert.equal(f.calls.length, 4);
  assert.equal(r.tasks[0].reviews.length, 2);
});

test("不完整或自相矛盾的 AI 审查不会被当成验收通过", async (t) => {
  const f = await fixture(t, 1);
  f.setResponse((c) => (c.review ? '```json\n{"passed":true}\n```' : null));
  await f.start();
  const r = await f.settled();
  assert.equal(r.tasks[0].status, "review");
  assert.ok(r.tasks[0].result);
  assert.match(r.job.note, /审查格式/);
  assert.equal(f.calls.length, 2);
  assert.throws(() =>
    parseReview(
      JSON.stringify({
        ...validReview(),
        checks: [
          { criterionIndex: 0, passed: true, evidence: "a" },
          { criterionIndex: 0, passed: true, evidence: "b" },
        ],
      }),
      f.state.tasks[0],
    ),
  );
  const contradictory = validReview();
  contradictory.checks[0].passed = false;
  assert.equal(
    parseReview(JSON.stringify(contradictory), f.state.tasks[0]).passed,
    false,
  );
});

test("人工任务不执行；审查指出必须外部操作时停止，不自动批准", async (t) => {
  const f = await fixture(t, 2);
  const snap = (await f.req("/workspace")).body;
  snap.state.tasks[1].executionMode = "human";
  snap.state.tasks[1].dependsOn = [];
  await f.req(
    "/workspace",
    { revision: snap.revision, state: snap.state },
    "PUT",
  );
  f.setResponse((c) =>
    c.review ? JSON.stringify(validReview(true, true)) : null,
  );
  await f.start();
  const r = await f.settled();
  assert.equal(f.calls.length, 2);
  assert.equal(r.tasks[0].status, "review");
  assert.match(r.tasks[0].automationBlock, /人工核实/);
  assert.equal(r.tasks[1].result, "");
});

test("生成期间项目资料发生变化不覆盖成果，结果仍可追溯", async (t) => {
  const f = await fixture(t, 1);
  let release;
  f.setResponse(
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  await f.start();
  await until(() => !!release);
  const snap = (await f.req("/workspace")).body;
  snap.state.knowledge.push({
    id: "note",
    title: "新要求",
    content: "更新了产品资料",
    category: "资料",
    updatedAt: new Date().toISOString(),
    projectId: f.projectId,
  });
  await f.req(
    "/workspace",
    { revision: snap.revision, state: snap.state },
    "PUT",
  );
  release(null);
  const r = await f.settled();
  assert.equal(r.job.status, "needs_attention");
  assert.match(r.job.note, /资料已变化/);
  assert.equal(r.tasks[0].result, "");
  assert.equal((await f.req("/runs")).body[0].hasOutput, true);
});

test("服务重启后不自行恢复费用调用，原执行和成果保留", async (t) => {
  const f = await fixture(t, 1);
  await f.start({ maxCalls: 2 });
  await f.settled();
  await f.restart();
  let db = openDatabase(f.dir);
  const job = db.listAutomations()[0];
  job.status = "running";
  db.saveAutomation(job);
  db.close();
  await f.restart();
  const r = await f.report();
  assert.equal(r.job.status, "paused");
  assert.equal(r.tasks[0].status, "done");
  assert.equal(f.calls.length, 2);
});

test("拒绝未经确认/过期版本启动，以及截断的模型输出", async (t) => {
  const f = await fixture(t, 1);
  assert.equal((await f.start({ confirmed: false })).status, 400);
  assert.equal((await f.start({ revision: 999 })).status, 409);
  assert.equal(f.calls.length, 0);
  f.setResponse(() => ({
    envelope: {
      choices: [{ finish_reason: "length", message: { content: "部分输出" } }],
    },
  }));
  await f.start();
  const r = await f.settled();
  assert.equal(r.tasks[0].result, "");
  assert.match(r.job.note, /长度限制/);
});

test("独立每日备份失败不将已经提交的数据库保存误报为失败", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-backup-error-"));
  const db = openDatabase(dir);
  t.after(async () => {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(dir, "daily-backups"), "simulate occupied path");
  const saved = db.save(seedWorkspace(), 0);
  assert.equal(saved.revision, 1);
  assert.equal(db.read().revision, 1);
});

test("已有成果被审查退回时也严格限制为一次返工；修改要求使旧审查失效", async (t) => {
  const f = await fixture(t, 1);
  let snap = (await f.req("/workspace")).body;
  snap.state.tasks[0].result = "原有待审查成果";
  snap.state.tasks[0].status = "review";
  await f.req(
    "/workspace",
    { revision: snap.revision, state: snap.state },
    "PUT",
  );
  f.setResponse((c) => (c.review ? JSON.stringify(validReview(false)) : null));
  await f.start();
  let r = await f.settled();
  assert.equal(f.calls.length, 3);
  assert.equal(r.tasks[0].reviews.length, 2);
  snap = (await f.req("/workspace")).body;
  snap.state.tasks[0].acceptanceCriteria = ["新的明确标准"];
  const saved = await f.req(
    "/workspace",
    { revision: snap.revision, state: snap.state },
    "PUT",
  );
  assert.equal(saved.status, 200);
  r = await f.report();
  assert.equal(r.tasks[0].aiReview, undefined);
});

test("系统时钟回拨时最新备份、执行记录排序及保留顺序仍正确", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-clock-"));
  const db = openDatabase(dir);
  t.after(async () => {
    t.mock.timers.reset();
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2030, 0, 1) });
  const first = seedWorkspace();
  db.save(first, 0);
  db.save({ ...first, profile: { ...first.profile, name: "第一次保存" } }, 1);
  db.saveRun({
    id: "first",
    status: "succeeded",
    startedAt: new Date().toISOString(),
  });
  t.mock.timers.setTime(Date.UTC(2029, 0, 1));
  db.save({ ...first, profile: { ...first.profile, name: "回拨后保存" } }, 2);
  const latest = db.backups()[0];
  assert.equal(latest.revision, 2);
  assert.equal(db.backup(latest.id).profile.name, "第一次保存");
  db.saveRun({
    id: "second",
    status: "succeeded",
    startedAt: new Date().toISOString(),
  });
  assert.equal(db.listRuns()[0].id, "second");
  db.saveRun({
    id: "first",
    status: "failed",
    startedAt: "2030-01-01T00:00:00.000Z",
  });
  assert.equal(db.listRuns()[0].id, "second");
});

const segment = (content, reason = "length", usage = true) => ({
  envelope: {
    choices: [{ finish_reason: reason, message: { content } }],
    ...(usage
      ? {
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }
      : {}),
  },
});

test("手动生成默认只调用一次，明确授权续写后累计所有分段用量", async (t) => {
  const f = await fixture(t, 1);
  const payload = {
    task: f.state.tasks[0],
    project: f.state.projects[0],
    member: f.state.members[0],
    knowledge: [],
  };
  f.setResponse(() => segment("首段"));
  const single = await f.req("/execute", payload);
  assert.notEqual(single.status, 200);
  assert.equal(f.calls.length, 1);
  assert.match(single.body.error, /长度限制/);
  assert.equal(
    (await f.req("/execute", { ...payload, maxParts: 5 })).status,
    400,
  );
  assert.equal(f.calls.length, 1);
  let count = 0;
  f.setResponse(() =>
    ++count === 1 ? segment("首段\n") : segment("尾段", "stop"),
  );
  const result = await f.req("/execute", { ...payload, maxParts: 4 });
  assert.equal(result.body.content, "首段\n尾段");
  const run = (await f.req(`/runs/${result.body.runId}`)).body;
  assert.equal(run.calls, 2);
  assert.deepEqual(run.usage, { input: 20, output: 40, total: 60 });
  assert.equal(run.usageIncomplete, false);
  assert.match(f.calls.at(-1).body.messages.at(-1).content, /从中断处接着写/);
});

test("自动续写计入批次调用上限，未完成草稿不落盘；缺失用量明确标记", async (t) => {
  const f = await fixture(t, 1);
  f.setResponse(() =>
    segment(`分段${f.calls.length}`, "length", f.calls.length === 1),
  );
  await f.start({ maxCalls: 2 });
  const report = await f.settled();
  assert.equal(f.calls.length, 2);
  assert.equal(report.job.usedCalls, 2);
  assert.equal(report.job.status, "needs_attention");
  assert.equal(report.tasks[0].result, "");
  assert.match(report.job.note, /截断草稿未保存/);
  const run = (await f.req("/runs")).body[0];
  assert.equal(run.calls, 2);
  assert.equal(run.usage.total, 30);
  assert.equal(run.usageIncomplete, true);
  assert.equal(run.hasOutput, false);
});

test("完成分段后才独立审查，累计批次用量且成果知识落到同一数据库快照", async (t) => {
  const f = await fixture(t, 1);
  let parts = 0;
  f.setResponse((c) =>
    c.review
      ? null
      : ++parts === 1
        ? segment("正文\n")
        : segment("使用方式与限制", "stop"),
  );
  await f.start({ maxCalls: 3 });
  const report = await f.settled();
  assert.equal(report.job.status, "completed");
  assert.equal(report.job.usedCalls, 3);
  assert.equal(report.tasks[0].result, "正文\n使用方式与限制");
  const snap = (await f.req("/workspace")).body;
  assert.ok(
    snap.state.knowledge.some(
      (n) =>
        n.sourceTaskId === report.tasks[0].id &&
        n.content === report.tasks[0].result,
    ),
  );
  const runs = (await f.req("/runs")).body;
  assert.deepEqual(
    runs.map((r) => r.usage.total),
    [30, 60],
  );
});
