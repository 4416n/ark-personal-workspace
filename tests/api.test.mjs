import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/index.mjs";

test("API 离线规划、私有凭据、真实请求转发及错误处理", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-test-"));
  let received;
  let fail = false;
  const upstream = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    received = {
      url: req.url,
      auth: req.headers.authorization,
      body: JSON.parse(raw),
    };
    res.setHeader("Content-Type", "application/json");
    if (fail) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: "SECRET_SHOULD_NEVER_LEAK" }));
      return;
    }
    const plan = received.body.messages[0].content.includes("规划师");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: plan
                ? JSON.stringify({
                    tasks: [
                      {
                        title: "调研目标用户",
                        description: "提供调研清单",
                        skills: ["调研"],
                        estimatedHours: 2,
                        priority: "high",
                      },
                    ],
                  })
                : "## 有效成果\n\n已根据目标生成可编辑内容。",
            },
          },
        ],
      }),
    );
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const server = createApp({
    configPath: path.join(directory, "ai.json"),
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (
    route,
    data,
    method = data === undefined ? "GET" : "POST",
    extra = {},
  ) => {
    const r = await fetch(base + route, {
      method,
      headers: { "Content-Type": "application/json", ...extra },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    assert.equal((await request("/api/config")).data.configured, false);
    assert.equal((await request("/api/test", {})).status, 400);
    const payload = {
      mode: "local",
      goal: "创建我的个人知识库",
      members: [],
      tasks: [],
    };
    assert.equal((await request("/api/plan", payload)).data.tasks.length, 5);
    assert.equal(
      (await request("/api/plan", { ...payload, goal: "" })).status,
      400,
    );
    assert.equal(
      (
        await request("/api/config", undefined, "GET", {
          origin: "https://attacker.example",
        })
      ).status,
      403,
    );
    const baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
    const config = {
      provider: "test",
      baseUrl,
      model: "mock-model",
      apiKey: "secret-test-token",
    };
    const saved = await request("/api/config", config);
    assert.equal(saved.data.configured, true);
    assert.ok(!JSON.stringify(saved.data).includes(config.apiKey));
    assert.ok(
      !JSON.stringify((await request("/api/config")).data).includes(
        config.apiKey,
      ),
    );
    assert.equal(
      (await fs.stat(path.join(directory, "ai.json"))).mode & 0o777,
      0o600,
    );
    assert.equal((await request("/api/test", {})).data.ok, true);
    assert.equal(received.auth, "Bearer secret-test-token");
    assert.equal(received.url, "/v1/chat/completions");
    assert.equal(received.body.model, "mock-model");
    const plan = await request("/api/plan", { ...payload, mode: "ai" });
    assert.equal(plan.data.source, "ai");
    assert.equal(plan.data.tasks[0].title, "调研目标用户");
    const execute = await request("/api/execute", {
      task: {
        title: "输出方案",
        description: "具体实施步骤",
        result: "旧版本成果",
        reviewNote: "补充边界条件",
      },
      project: { title: "项目", goal: "实现计划" },
      member: {
        id: "m",
        name: "小策",
        role: "策略师",
        skills: ["调研"],
        capacity: 40,
      },
      knowledge: [{ title: "实施方案背景", content: "我的真实资料：具体实施步骤需要包含风险与边界条件。" }],
      dependencies: [{ title: "需求已确认", result: "前置任务的验收结论" }],
    });
    assert.equal(execute.data.source, "ai");
    assert.ok(received.body.messages[1].content.includes("我的真实资料"));
    for (const text of ["旧版本成果", "补充边界条件", "前置任务的验收结论"])
      assert.ok(received.body.messages[1].content.includes(text), text);
    const chat = await request("/api/chat", {
      messages: [{ role: "user", content: "今天做什么" }],
      context: "待办有三项",
      knowledge: [],
    });
    assert.ok(chat.data.content.includes("有效成果"));
    fail = true;
    const failed = await request("/api/test", {});
    assert.equal(failed.status, 500);
    assert.ok(failed.data.error.includes("API Key 无效"));
    assert.ok(!failed.data.error.includes("SECRET"));
    assert.equal(
      (
        await request("/api/config", {
          ...config,
          apiKey: "",
          baseUrl: "http://remote.example/v1",
        })
      ).status,
      400,
    );
    const changed = await request("/api/config", {
      ...config,
      apiKey: "",
      baseUrl: baseUrl + "/other",
    });
    assert.equal(changed.data.configured, false);
    assert.equal(
      (await request("/api/config", undefined, "DELETE")).data.configured,
      false,
    );
  } finally {
    await new Promise((r) => server.close(r));
    await new Promise((r) => upstream.close(r));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
