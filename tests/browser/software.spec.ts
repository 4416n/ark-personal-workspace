import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http, { type Server } from "node:http";
import { createApp } from "../../server/index.mjs";
import { seedWorkspace } from "../../src/domain";
import { fullstackFixture } from "../fixtures/fullstack.mjs";
import { stagedResponse } from "../fixtures/staged.mjs";
import { validateProject, sandboxAvailable } from "../../server/project-sandbox.mjs";
import { removeTestDirectory } from "../helpers/filesystem.mjs";
import { readVerifiedZip } from "../helpers/zip.mjs";
const realBuild = process.env.ARK_REAL_BROWSER_BUILD === "1";
// Each real validator can use its full 120-second isolation budget plus
// environment probes and cleanup. Mock-mode deadlines remain unchanged.
const validationTimeout = realBuild ? 150000 : 60000;
let dir: string,
  server: Server,
  upstream: Server,
  app: ReturnType<typeof createApp>,
  base: string,
  hold: boolean,
  calls: number;
let holdStage = "";
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
  if (realBuild) test.setTimeout(360000);
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-software-browser-"));
  hold = false;
  holdStage = "";
  calls = 0;
  upstream = http
    .createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw);
      calls++;
      if (
        hold ||
        (holdStage &&
          request.messages.at(-1).content.startsWith(`本次阶段：${holdStage}`))
      )
        return;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: stagedResponse(request) } }],
        }),
      );
    })
    .listen(0, "127.0.0.1");
  await new Promise((r) => upstream.once("listening", r));
  app = createApp({
    shared: true,
    configPath: path.join(dir, "ai-config.json"),
    softwareOptions: {
      capability: realBuild
        ? sandboxAvailable
        : async () => ({ available: true, reason: "测试环境" }),
      validator: realBuild
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
  await app.locals.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  await removeTestDirectory(dir);
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
  test.setTimeout(realBuild ? 210000 : 90000);
  await panel(page);
  await start(page);
  await expect(page.locator(".software-heading")).toContainText(
    "构建与冒烟通过",
    { timeout: validationTimeout },
  );
  expect(calls).toBe(5);
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
  const files = await readVerifiedZip(content);
  expect(files.get("Dockerfile")).toContain("FROM");
  expect(files.get("server/app.mjs")).toContain("DatabaseSync");
  const report = JSON.parse(files.get("verification-report.json")!);
  expect(report.validation.passed).toBe(true);
  if (realBuild) {
    expect(report.validation.verificationVersion).toBe(2);
    expect(report.validation.checks.some((check: { name: string; passed: boolean }) =>
      check.name.includes("重启") && check.passed)).toBe(true);
    expect(report.validation.checks.some((check: { name: string; passed: boolean }) =>
      check.name.includes("无缓存读回") && check.passed)).toBe(true);
  }
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
  expect(calls).toBe(5);
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
      timeout: validationTimeout,
    })
    .toBe("verified");
  const second = await req(`/software/${id}/start`, body);
  await expect
    .poll(async () => (await req(`/software-builds/${second.id}`)).status, {
      timeout: validationTimeout,
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
    { timeout: validationTimeout },
  );
  expect(calls).toBe(5);
  expect((await req("/workspace")).state.projects[0].deliveryType).toBe(
    "software",
  );
});

test("revalidate needs no API key, keeps history and makes zero additional model calls", async ({
  page,
}) => {
  test.setTimeout(realBuild ? 360000 : 90000);
  const original = await req(`/software/${id}/start`, {
    confirmed: true,
    allowSandbox: true,
    revision: 1,
    maxRepairs: 0,
  });
  await expect
    .poll(async () => (await req(`/software-builds/${original.id}`)).status, {
      timeout: validationTimeout,
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
    { timeout: validationTimeout },
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
  test.setTimeout(realBuild ? 510000 : 90000);
  const original = await req(`/software/${id}/start`, {
    confirmed: true,
    allowSandbox: true,
    revision: 1,
    maxRepairs: 0,
  });
  await expect
    .poll(async () => (await req(`/software-builds/${original.id}`)).status, {
      timeout: validationTimeout,
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
      { timeout: validationTimeout },
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
      { timeout: validationTimeout },
    )
    .toBeTruthy();
  expect((await req(`/software/${id}`)).builds[0].baseBuildId).toBeNull();
  expect(calls).toBe(11);
});

test("staged mobile recovery keeps backend checkpoint and explicit human acceptance", async ({
  page,
}) => {
  test.setTimeout(realBuild ? 210000 : 90000);
  holdStage = "frontend";
  await panel(page);
  await expect(page.getByLabel("工程执行方式")).toHaveValue("staged");
  await page.getByLabel("工程自动修复次数").selectOption("0");
  await start(page);
  await expect.poll(() => calls).toBe(3);
  await page.getByRole("button", { name: "停止工程交付" }).click();
  await expect(page.locator(".software-heading")).toContainText("已停止");
  await expect(
    page.getByRole("button", { name: "从检查点继续" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: /下载.*ZIP/ })).toHaveCount(0);
  await expect(page.getByLabel("文件源码")).toContainText("DatabaseSync");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page
    .getByRole("button", { name: /完整网站交付测试.*项目进度/ })
    .click();
  await expect(
    page.getByRole("region", { name: "阶段与需求验收" }),
  ).toBeVisible();
  await page.getByLabel("恢复追加次数").selectOption("1");
  const dismissedResume = new Promise<void>((resolve) =>
    page.once("dialog", async (d) => {
      await d.dismiss();
      resolve();
    }),
  );
  await page.getByRole("button", { name: "从检查点继续" }).click();
  await dismissedResume;
  await expect(
    page.getByRole("button", { name: "从检查点继续" }),
  ).toBeEnabled();
  expect(calls).toBe(3);
  holdStage = "";
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "从检查点继续" }).click();
  await expect(page.locator(".software-heading")).toContainText(
    "构建与冒烟通过",
    { timeout: validationTimeout },
  );
  expect(calls).toBe(6);
  await expect(
    page.getByRole("region", { name: "逐条需求验收" }),
  ).toContainText("尚未完成全部人工验收");
  const first = page.locator(".engineering-acceptance > details").first();
  await first.locator("summary").click();
  await expect(
    first.getByRole("button", { name: "确认此项通过" }),
  ).toBeDisabled();
  await first
    .getByLabel("验收意见 1", { exact: true })
    .fill("已检查样例新增笔记与重启读回，测试使用模拟模型");
  page.once("dialog", (d) => d.accept());
  await first.getByRole("button", { name: "确认此项通过" }).click();
  await expect(first.locator("summary")).toContainText("人工通过");
  expect(calls).toBe(6);
  expect(
    await page
      .locator(".modal")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/staged-acceptance-mobile.png",
    animations: "disabled",
  });
});

test("mobile recommendation keeps the newer source baseline after an old version is revalidated", async ({
  page,
}) => {
  test.setTimeout(realBuild ? 660000 : 120000);
  const create = async () => {
    const b = await req(`/software/${id}/start`, {
      confirmed: true,
      allowSandbox: true,
      revision: (await req("/workspace")).revision,
      maxRepairs: 0,
    });
    await expect
      .poll(async () => (await req(`/software-builds/${b.id}`)).status, {
        timeout: validationTimeout,
      })
      .toBe("verified");
    return b;
  };
  const older = await create();
  const snapshot = await req("/workspace");
  snapshot.state.projects[0].goal += " 加入新的业务约束";
  await req("/workspace", snapshot, "PUT");
  const newer = await create();
  const recheck = await req(`/software-builds/${older.id}/revalidate`, {
    confirmed: true,
    allowSandbox: true,
    revision: (await req("/workspace")).revision,
  });
  await expect
    .poll(async () => (await req(`/software-builds/${recheck.id}`)).status, {
      timeout: validationTimeout,
    })
    .toBe("verified");
  expect((await req(`/software/${id}`)).recommendedBuildId).toBe(newer.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await panel(page);
  await expect(page.getByLabel("工程生成起点", { exact: true })).toHaveValue(
    "recommended",
  );
  await expect(page.locator(".software-panel")).toContainText("源码基线");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "生成新版本", exact: true }).click();
  await expect
    .poll(
      async () => {
        const b = (await req(`/software/${id}`)).builds[0];
        return (
          b.id !== recheck.id &&
          b.status === "verified" &&
          b.baseBuildId === newer.id
        );
      },
      { timeout: validationTimeout },
    )
    .toBe(true);
  await expect(page.locator(".software-heading")).toContainText(
    "构建与冒烟通过",
  );
  await page.screenshot({
    path: "artifacts/source-baseline-390.png",
    animations: "disabled",
  });
});
