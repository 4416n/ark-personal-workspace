import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/index.mjs";
import { openDatabase } from "../server/database.mjs";
import { lanAddresses } from "../server/access.mjs";
import { seedWorkspace, stateSchema, templateSchema } from "../src/domain.ts";
import { projectToTemplate, instantiateTemplate } from "../src/templates.ts";
import { mergeWorkspace } from "../shared/merge.mjs";
import { retrieve } from "../shared/retrieval.mjs";

test("数据库原子保存、过期版本拒绝、备份预览及重启持久化", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-db-"));
  let db = openDatabase(directory);
  try {
    const s = seedWorkspace();
    db.save(s, 0);
    const next = { ...s, tasks: s.tasks.slice(1) };
    db.save(next, 1);
    assert.throws(() => db.save(s, 1), { status: 409 });
    assert.equal(db.read().revision, 2);
    assert.deepEqual(db.backup(db.backups()[0].id), s);
    assert.throws(() =>
      db.save({ ...s, tasks: [{ ...s.tasks[0], dependsOn: ["missing"] }] }, 2),
    );
    assert.equal(db.read().revision, 2);
    assert.equal(
      (await fs.stat(path.join(directory, "workspace.sqlite"))).mode & 0o777,
      0o600,
    );
    assert.equal(
      (await fs.readdir(path.join(directory, "daily-backups"))).length,
      1,
    );
    db.close();
    db = openDatabase(directory);
    assert.deepEqual(db.read().state, next);
  } finally {
    db.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("共享编辑自动合并独立修改，同字段冲突与删除冲突显式保留", () => {
  const base = seedWorkspace(),
    a = structuredClone(base),
    b = structuredClone(base);
  a.tasks[0].title = "电脑修改";
  b.knowledge[0].content = "手机修改";
  const merged = mergeWorkspace(base, a, b);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.state.tasks[0].title, "电脑修改");
  assert.equal(merged.state.knowledge[0].content, "手机修改");
  b.tasks[0].title = "另一标题";
  assert.ok(
    mergeWorkspace(base, a, b).conflicts.some((p) => p.includes("title")),
  );
  a.tasks = a.tasks.slice(1);
  assert.ok(
    mergeWorkspace(base, a, b).conflicts.some((p) => p.includes("tasks")),
  );
});

test("RAG 检索相关片段，项目隔离、无命中与片段上限可验证", () => {
  const notes = [
    {
      id: "a",
      title: "个人品牌定位",
      content: "面向独立开发者，用真实案例解释个人品牌定位和内容风格。",
    },
    {
      id: "b",
      title: "品牌设计",
      projectId: "p1",
      content: "本项目的个人品牌主色为深绿色，字体使用无衬线。",
    },
    {
      id: "c",
      title: "品牌设计",
      projectId: "p2",
      content: "绝不能发给另一个项目的私人品牌资料。",
    },
    { id: "d", title: "汽车维护", content: "轮胎需要定期检查气压。" },
  ];
  const matches = retrieve(notes, "个人品牌定位和设计", "p1");
  assert.ok(matches.some((p) => p.noteId === "a"));
  assert.ok(matches.some((p) => p.noteId === "b"));
  assert.ok(!matches.some((p) => p.noteId === "c" || p.noteId === "d"));
  assert.ok(
    matches.every(
      (p) => p.content.length <= 900 && p.end - p.start === p.content.length,
    ),
  );
  assert.equal(retrieve(notes, "量子纠缠").length, 0);
  assert.ok(retrieve(notes, "个人品牌").every((p) => !p.projectId));
  const semantic = retrieve(
    [
      {
        id: "kb",
        title: "公司制度条目",
        content: "把制度、流程和常见问题整理成可检索的条目。",
      },
      { id: "car", title: "汽车维护", content: "轮胎需要定期检查气压。" },
    ],
    "知识库应该收录什么",
  );
  assert.ok(semantic.some((passage) => passage.noteId === "kb"));
  assert.ok(!semantic.some((passage) => passage.noteId === "car"));
});

test("流程模板复用依赖与相对日期，暂停员工重分配，成果与审批不复制", () => {
  const s = seedWorkspace();
  s.tasks[1].dependsOn = [s.tasks[0].id];
  s.tasks[0].result = "不能复制的旧成果";
  const template = projectToTemplate(s.projects[0], s.tasks, "知识库流程");
  assert.ok(!JSON.stringify(template).includes("不能复制的旧成果"));
  s.members[0].availability = "paused";
  const created = instantiateTemplate(template, s, "新知识库", "2027-01-31");
  assert.equal(
    created.tasks.find((t) => t.title === s.tasks[1].title).dependsOn[0],
    created.tasks.find((t) => t.title === s.tasks[0].title).id,
  );
  assert.ok(
    created.tasks.every(
      (t) => t.status === "todo" && !t.result && !t.reviews && !t.demo,
    ),
  );
  assert.ok(created.tasks.every((t) => t.ownerId !== s.members[0].id));
  assert.equal(
    Date.parse(created.tasks[0].deadline) -
      Date.parse(created.project.deadline),
    template.tasks[0].dayOffset * 86400000,
  );
  assert.ok(
    stateSchema.safeParse({
      ...s,
      projects: [...s.projects, created.project],
      tasks: [...s.tasks, ...created.tasks],
      templates: [template],
    }).success,
  );
  assert.ok(
    !templateSchema.safeParse({
      ...template,
      tasks: [{ ...template.tasks[0], dependsOn: [0] }],
    }).success,
  );
});

test("局域网配对、一次性码、会话撤销与模型配置本机限制", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-lan-"));
  const address = lanAddresses()[0]?.address;
  assert.ok(address, "测试环境需有局域网接口");
  const app = createApp({
    shared: true,
    lan: true,
    configPath: path.join(directory, "ai.json"),
  });
  const server = app.listen(0, "0.0.0.0");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const host = `${address}:${server.address().port}`;
  const request = (route, body, headers = {}, method = body ? "POST" : "GET") =>
    new Promise((resolve, reject) => {
      const r = http.request(
        base + route,
        { method, headers: { "Content-Type": "application/json", ...headers } },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              json: async () => JSON.parse(text),
              headers: {
                get: (key) =>
                  Array.isArray(res.headers[key])
                    ? res.headers[key][0]
                    : res.headers[key],
              },
            }),
          );
        },
      );
      r.on("error", reject);
      r.end(body ? JSON.stringify(body) : undefined);
    });
  try {
    assert.equal(
      (await request("/api/workspace", undefined, { Host: host })).status,
      401,
    );
    assert.equal(
      (await request("/api/config", undefined, { Host: "evil.invalid" }))
        .status,
      403,
    );
    assert.equal(
      (
        await request("/api/config", undefined, {
          Origin: "http://evil.invalid",
        })
      ).status,
      403,
    );
    const code = await (await request("/api/connection/code", {})).json();
    assert.equal(
      (await request("/api/pair", { code: "中文字八个试试啊" }, { Host: host }))
        .status,
      401,
    );
    const paired = await request(
      "/api/pair",
      { code: code.code },
      { Host: host },
    );
    assert.equal(paired.status, 200);
    const Cookie = paired.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (await request("/api/pair", { code: code.code }, { Host: host })).status,
      401,
    );
    assert.equal(
      (await request("/api/workspace", undefined, { Host: host, Cookie }))
        .status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/config",
          { apiKey: "never-store" },
          { Host: host, Cookie },
        )
      ).status,
      403,
    );
    await request("/api/connection/devices", undefined, {}, "DELETE");
    assert.equal(
      (await request("/api/workspace", undefined, { Host: host, Cookie }))
        .status,
      401,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    app.locals.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("AI 执行真实记录模型用量和参考资料，取消可中断且重启保留", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-runs-"));
  let wait = false,
    received;
  const upstream = http
    .createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      received = JSON.parse(raw);
      if (wait) return;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "有来源的成果[资料1]" } }],
          usage: {
            prompt_tokens: 80,
            completion_tokens: 20,
            total_tokens: 100,
          },
        }),
      );
    })
    .listen(0, "127.0.0.1");
  await new Promise((r) => upstream.once("listening", r));
  const app = createApp({
    shared: true,
    configPath: path.join(directory, "ai.json"),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (route, body, extra = {}) =>
    fetch(base + route, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...extra },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    await send("/api/config", {
      provider: "test",
      baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
      model: "mock",
      apiKey: "secret-never-expose",
    });
    const body = {
      task: { title: "品牌定位方案", description: "品牌定位" },
      project: { id: "p", title: "品牌", goal: "完成品牌定位" },
      member: {
        id: "m",
        name: "小策",
        role: "策略师",
        skills: [],
        capacity: 40,
      },
      knowledge: [
        { id: "k", title: "品牌定位", content: "目标读者是独立开发者。" },
        {
          id: "other",
          projectId: "x",
          title: "品牌定位",
          content: "其他项目秘密",
        },
      ],
    };
    const result = await (await send("/api/execute", body)).json();
    const run = await (await send(`/api/runs/${result.runId}`)).json();
    assert.equal(run.status, "succeeded");
    assert.equal(run.usage.total, 100);
    assert.equal(run.sources[0].noteId, "k");
    assert.ok(!JSON.stringify(received).includes("其他项目秘密"));
    assert.ok(!JSON.stringify(run).includes("secret-never-expose"));
    wait = true;
    received = null;
    const id = randomUUID();
    const pending = send("/api/execute", body, { "X-Run-Id": id });
    for (let i = 0; i < 40 && !received; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      (await (await send(`/api/runs/${id}/cancel`, {})).json()).cancelled,
      true,
    );
    await pending;
    assert.equal(
      (await (await send(`/api/runs/${id}`)).json()).status,
      "cancelled",
    );
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((r) => server.close(r)),
      new Promise((r) => upstream.close(r)),
    ]);
    app.locals.close();
  }
  const reopened = openDatabase(directory);
  assert.equal(reopened.listRuns().length, 2);
  reopened.close();
  await fs.rm(directory, { recursive: true, force: true });
});
