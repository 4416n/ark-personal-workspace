import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http, { type Server } from "node:http";
import { createApp } from "../../server/index.mjs";
import { seedWorkspace } from "../../src/domain";
import { fullstackFixture } from "../fixtures/fullstack.mjs";
import { validateProject } from "../../server/project-sandbox.mjs";
let dir: string,
  server: Server,
  upstream: Server,
  app: ReturnType<typeof createApp>,
  base: string,
  hold: boolean,
  calls: number;
const id = "software-project";
const req = async (
  route: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) => {
  const r = await fetch(base + "/api" + route, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  expect(r.ok).toBeTruthy();
  return r.json();
};
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-software-browser-"));
  hold = false;
  calls = 0;
  upstream = http
    .createServer(async (req, res) => {
      for await (const _ of req) {
      }
      calls++;
      if (hold) return;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify(fullstackFixture()) } },
          ],
        }),
      );
    })
    .listen(0, "127.0.0.1");
  await new Promise((r) => upstream.once("listening", r));
  app = createApp({
    shared: true,
    configPath: path.join(dir, "ai-config.json"),
    softwareOptions: {
      capability: async () => ({ available: true, reason: "测试环境" }),
      validator: process.env.ARK_REAL_BROWSER_BUILD
        ? validateProject
        : async () => ({
            passed: true,
            checks: [
              {
                name: "构建测试（模拟结果）",
                passed: true,
                detail: "仅用于工作台界面测试",
              },
            ],
            logs: "mock harness log",
            scope: "界面测试模拟报告，不是真实运行验收",
          }),
    },
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const s = seedWorkspace();
  s.projects = [
    {
      ...s.projects[0],
      id,
      title: "完整网站交付测试",
      goal: "制作可新增、查询、删除的个人笔记网站，前后端和数据库完整实现",
      deliveryType: "software",
    },
  ];
  s.tasks = [];
  s.knowledge = [];
  await req("/workspace", { state: s, revision: 0 }, "PUT");
  await req("/config", {
    provider: "mock",
    model: "mock",
    apiKey: "test-only",
    baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`,
  });
});
test.afterEach(async () => {
  app.locals.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  await new Promise((r) => setTimeout(r, 50));
  await fs.rm(dir, { recursive: true, force: true });
});
async function panel(page: Page) {
  await page.goto(base + "/#projects");
  await page
    .getByRole("button", { name: /完整网站交付测试.*项目进度/ })
    .click();
  await expect(
    page.getByRole("region", { name: "完整工程交付" }),
  ).toBeVisible();
}
async function start(page: Page) {
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "生成完整工程", exact: true }).click();
}
test("website project opens engineering; delivers source tree, ZIP, validation and mobile layout", async ({
  page,
}) => {
  test.setTimeout(90000);
  await panel(page);
  await start(page);
  await expect(page.locator(".software-heading")).toContainText(
    "构建与冒烟通过",
    { timeout: 60000 },
  );
  expect(calls).toBe(1);
  await page
    .getByRole("button", { name: "server/app.mjs", exact: false })
    .click();
  await expect(page.getByLabel("文件源码")).toContainText("DatabaseSync");
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载完整工程 ZIP", exact: true })
    .click();
  const file = await (await downloading).path();
  const content = await fs.readFile(file!);
  expect(content.readUInt32LE(0)).toBe(0x04034b50);
  expect(content.includes(Buffer.from("Dockerfile"))).toBeTruthy();
  expect(
    content.includes(Buffer.from("verification-report.json")),
  ).toBeTruthy();
  await page.locator(".software-workspace").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/v32-engineering-desktop.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".software-workspace").scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(
    await page
      .locator(".modal")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: "artifacts/v32-engineering-mobile.png",
    animations: "disabled",
  });
  await page.reload();
  await page
    .getByRole("button", { name: /完整网站交付测试.*项目进度/ })
    .click();
  await expect(
    page.getByRole("button", { name: "下载完整工程 ZIP" }),
  ).toBeVisible();
  expect(calls).toBe(1);
});
test("stop background generation, retain explicit status, do not offer fabricated download", async ({
  page,
}) => {
  hold = true;
  await panel(page);
  await start(page);
  await expect(
    page.getByRole("button", { name: "停止工程交付" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "停止工程交付" }).click();
  await expect(page.locator(".software-heading")).toContainText("已停止");
  await expect(page.getByRole("button", { name: /下载.*ZIP/ })).toHaveCount(0);
  expect(calls).toBe(1);
});
test("revisions retain selected history and stale requirement warning", async ({
  page,
}) => {
  const body = {
    confirmed: true,
    allowSandbox: true,
    revision: 1,
    maxRepairs: 0,
  };
  const first = await req(`/software/${id}/start`, body);
  await expect
    .poll(async () => (await req(`/software-builds/${first.id}`)).status, {
      timeout: 60000,
    })
    .toBe("verified");
  const second = await req(`/software/${id}/start`, body);
  await expect
    .poll(async () => (await req(`/software-builds/${second.id}`)).status, {
      timeout: 60000,
    })
    .toBe("verified");
  await panel(page);
  await page.getByLabel("工程版本", { exact: true }).selectOption(first.id);
  await page.waitForTimeout(2000);
  await expect(page.getByLabel("工程版本", { exact: true })).toHaveValue(
    first.id,
  );
  const snapshot = await req("/workspace");
  snapshot.state.projects[0].goal += "，新增标签过滤";
  await req("/workspace", snapshot, "PUT");
  await expect(page.locator(".software-panel")).toContainText(
    "这一版对应旧需求",
  );
  expect(calls).toBe(2);
});

test("new website goal selects engineering and requires confirmation before generating", async ({
  page,
}) => {
  await page.goto(base);
  await page.getByRole("button", { name: "拆解新目标" }).click();
  await page.getByLabel("项目名称").fill("我的笔记网站");
  await page
    .getByLabel("我想实现的目标")
    .fill("交付支持笔记增删查的完整前后端网站");
  await expect(page.getByLabel("交付形式", { exact: true })).toHaveValue(
    "software",
  );
  await page.route("**/api/plan", (route) =>
    route.fulfill({
      json: {
        tasks: [
          {
            title: "实现笔记完整功能",
            description: "完整前后端与SQLite数据",
            deliverable: "可运行工程",
            acceptanceCriteria: ["浏览器可创建并读回笔记"],
            executionMode: "ai",
            ownerId: "member-content",
            skills: [],
            estimatedHours: 2,
            priority: "medium",
            reason: "测试分配",
            dependsOn: [],
          },
        ],
        source: "local",
      },
    }),
  );
  await page.getByRole("button", { name: "生成执行计划", exact: true }).click();
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "创建并交付工程", exact: true })
    .click();
  expect(calls).toBe(0);
  expect((await req("/workspace")).state.projects).toHaveLength(1);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "创建并交付工程", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "完整工程交付" }),
  ).toBeVisible();
  await expect(page.locator(".software-heading")).toContainText(
    "构建与冒烟通过",
    { timeout: 60000 },
  );
  expect(calls).toBe(1);
  expect((await req("/workspace")).state.projects[0].deliveryType).toBe(
    "software",
  );
});

test("revalidate needs no API key, keeps history and makes zero additional model calls", async ({
  page,
}) => {
  test.setTimeout(90000);
  const original = await req(`/software/${id}/start`, {
    confirmed: true,
    allowSandbox: true,
    revision: 1,
    maxRepairs: 0,
  });
  await expect
    .poll(async () => (await req(`/software-builds/${original.id}`)).status, {
      timeout: 60000,
    })
    .toBe("verified");
  await fs.writeFile(
    path.join(dir, "ai-config.json"),
    JSON.stringify({ apiKey: "" }),
  );
  await panel(page);
  await expect(
    page.getByRole("button", { name: "生成新版本", exact: true }),
  ).toBeDisabled();
  const dismissed = new Promise<void>((resolve) =>
    page.once("dialog", async (d) => {
      await d.dismiss();
      resolve();
    }),
  );
  await page
    .getByRole("button", { name: "仅重新验证（不调用 AI）", exact: true })
    .click();
  await dismissed;
  await expect(
    page.getByRole("button", { name: "仅重新验证（不调用 AI）", exact: true }),
  ).toBeEnabled();
  expect((await req(`/software/${id}`)).builds).toHaveLength(1);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "仅重新验证（不调用 AI）", exact: true })
    .click();
  await expect(page.locator(".software-lineage")).toContainText("没有调用模型");
  await expect(page.locator(".software-heading")).toContainText(
    "构建与冒烟通过",
    { timeout: 60000 },
  );
  const records = (await req(`/software/${id}`)).builds;
  expect(records).toHaveLength(2);
  expect(records[0].mode).toBe("validate");
  expect(records[0].baseBuildId).toBe(original.id);
  expect(calls).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".software-base").scrollIntoViewIfNeeded();
  expect(
    await page
      .locator(".modal")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: "artifacts/v321-revalidation-mobile.png",
    animations: "disabled",
  });
  await page.getByLabel("工程版本", { exact: true }).selectOption(original.id);
  await expect(page.locator(".software-lineage")).toHaveCount(0);
});
test("generation uses the selected base or deliberately starts fresh", async ({
  page,
}) => {
  test.setTimeout(90000);
  const original = await req(`/software/${id}/start`, {
    confirmed: true,
    allowSandbox: true,
    revision: 1,
    maxRepairs: 0,
  });
  await expect
    .poll(async () => (await req(`/software-builds/${original.id}`)).status, {
      timeout: 60000,
    })
    .toBe("verified");
  await panel(page);
  await page
    .getByLabel("工程生成起点", { exact: true })
    .selectOption(original.id);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "生成新版本", exact: true }).click();
  await expect
    .poll(
      async () => {
        const b = (await req(`/software/${id}`)).builds[0];
        return b.id !== original.id && b.status === "verified";
      },
      { timeout: 60000 },
    )
    .toBeTruthy();
  expect((await req(`/software/${id}`)).builds[0].baseBuildId).toBe(
    original.id,
  );
  await expect(
    page.getByRole("button", { name: "生成新版本", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("工程生成起点", { exact: true }).selectOption("fresh");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "生成新版本", exact: true }).click();
  await expect
    .poll(
      async () => {
        const rows = (await req(`/software/${id}`)).builds;
        return rows.length === 3 && rows[0].status === "verified";
      },
      { timeout: 60000 },
    )
    .toBeTruthy();
  expect((await req(`/software/${id}`)).builds[0].baseBuildId).toBeNull();
  expect(calls).toBe(3);
});
