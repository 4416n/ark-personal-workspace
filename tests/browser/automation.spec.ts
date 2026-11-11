import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http, { type Server } from "node:http";
import { createApp } from "../../server/index.mjs";
import { seedWorkspace } from "../../src/domain";
import { removeTestDirectory } from "../helpers/filesystem.mjs";

let directory: string,
  server: Server,
  upstream: Server,
  app: ReturnType<typeof createApp>,
  base: string,
  calls: number,
  hold: boolean;
const projectId = "automation-project";
const request = async (
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
async function panel(page: Page) {
  await page.goto(base + "/#projects");
  await page
    .getByRole("button", { name: /自动执行验证项目.*项目进度/ })
    .click();
  await page.getByRole("button", { name: "自动执行", exact: true }).click();
  await expect(page.locator(".manifest-item")).toHaveCount(2);
}
async function start(page: Page, button = "启动自动执行") {
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: button, exact: true }).click();
}
test.beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-auto-browser-"));
  calls = 0;
  hold = false;
  upstream = http
    .createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      calls++;
      if (hold) return;
      const review =
        JSON.parse(raw).messages[0].content.includes("独立的交付审查员");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: review
                  ? JSON.stringify({
                      passed: true,
                      requiresHuman: false,
                      summary: "交付正文可直接编辑使用，符合两项标准。",
                      checks: [0, 1].map((criterionIndex) => ({
                        criterionIndex,
                        passed: true,
                        evidence: "正文包含完整结构、实际示例和使用步骤。",
                      })),
                    })
                  : "# 本周内容策划\n\n## 交付内容\n周二发布知识管理入门，周五发布个人工作流复盘。\n\n## 使用方式\n按实际案例补充后由本人发布。\n\n## 待确认与限制\n这是可编辑草稿，尚未对外发布。",
              },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        }),
      );
    })
    .listen(0, "127.0.0.1");
  await new Promise((r) => upstream.once("listening", r));
  app = createApp({
    shared: true,
    configPath: path.join(directory, "ai-config.json"),
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const s = seedWorkspace();
  s.projects = [
    {
      ...s.projects[0],
      id: projectId,
      title: "自动执行验证项目",
      goal: "交付两份可使用的选题文稿，不要求实际发布",
    },
  ];
  s.knowledge = [];
  s.tasks = s.tasks
    .slice(0, 2)
    .map((t, i) => ({
      ...t,
      id: `auto-${i}`,
      projectId,
      ownerId: "member-content",
      status: "todo",
      result: "",
      title: `交付第${i + 1}份选题文稿`,
      deliverable: `第${i + 1}份选题文稿.md`,
      acceptanceCriteria: ["有完整文稿和实际示例", "说明使用步骤与限制"],
      executionMode: "ai",
      dependsOn: i ? ["auto-0"] : [],
    }));
  await request("/workspace", { revision: 0, state: s }, "PUT");
  await request("/config", {
    provider: "mock",
    baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`,
    model: "mock-review-model",
    apiKey: "test-only",
  });
});
test.afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await app.locals.close();
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  await removeTestDirectory(directory);
});

test("一键自动交付审查、进度同步、交付包导出与手机可读", async ({ page }) => {
  await panel(page);
  await start(page);
  await expect(page.locator(".automation-heading")).toContainText(
    "本批交付已就绪",
  );
  await expect(page.locator(".detail-progress")).toContainText("2/2");
  expect(calls).toBe(4);
  await page.locator(".manifest-item summary").first().click();
  await expect(page.locator(".ai-review-summary").first()).toContainText(
    "AI 独立审查 · 通过",
  );
  await expect(page.locator(".manifest-body .markdown").first()).toContainText(
    "本周内容策划",
  );
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出文档交付包", exact: true })
    .click();
  const file = await (await downloadPromise).path();
  const text = await fs.readFile(file!, "utf8");
  expect(text).toContain("第1份选题文稿.md");
  expect(text).toContain("AI通过");
  await page.screenshot({
    path: "artifacts/v31-automation-desktop.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator("[role=dialog]")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
  await page.locator(".automation-panel").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/v31-automation-mobile.png",
    animations: "disabled",
  });
});

test("关闭页面后后台继续；重新打开可暂停恢复且不重复启动", async ({
  page,
  browser,
}) => {
  hold = true;
  await panel(page);
  await start(page);
  await expect.poll(() => calls).toBe(1);
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page.goto("about:blank");
  const other = await browser.newPage();
  await panel(other);
  await expect(
    other.getByRole("button", { name: "暂停自动执行" }),
  ).toBeVisible();
  expect(calls).toBe(1);
  await other.getByRole("button", { name: "暂停自动执行" }).click();
  await expect(other.locator(".automation-heading")).toContainText("已暂停");
  hold = false;
  await start(other, "确认并恢复执行");
  await expect(other.locator(".automation-heading")).toContainText(
    "本批交付已就绪",
  );
  expect(calls).toBe(5);
  await other.reload();
  await panel(other);
  expect(calls).toBe(5);
  await other.close();
});

test("人工验收模式停在审查通过处，可打开最新成果验收后恢复", async ({
  page,
}) => {
  await panel(page);
  await page.getByLabel("自动验收方式").selectOption("manual");
  await start(page);
  await expect(page.locator(".automation-heading")).toContainText("需要你处理");
  expect(calls).toBe(2);
  await page.locator(".manifest-item summary").first().click();
  await expect(page.locator(".manifest-block").first()).toContainText(
    "等待人工验收",
  );
  await page
    .getByRole("button", { name: "打开任务，人工调整或验收" })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("AI 独立审查 · 通过");
  await page.getByRole("button", { name: "验收通过", exact: true }).click();
  await panel(page);
  await start(page, "确认并恢复执行");
  await expect.poll(() => calls).toBe(4);
  await expect(page.locator(".automation-heading")).toContainText("需要你处理");
  expect((await request("/workspace")).state.tasks[0].reviews[0].actor).toBe(
    "human",
  );
});

test("确认计划后可直接创建并自动执行，取消确认不创建也不调用", async ({
  page,
}) => {
  await page.goto(base);
  await page.getByRole("button", { name: "拆解新目标" }).click();
  await page.getByLabel("项目名称").fill("从新目标直接自动交付");
  await page.getByLabel("我想实现的目标").fill("交付一份具体可使用的选题文稿");
  await page.route("**/api/plan", (route) =>
    route.fulfill({
      json: {
        tasks: [
          {
            title: "写出一份选题文稿",
            description: "输出完整选题文稿",
            deliverable: "选题文稿.md",
            acceptanceCriteria: ["有完整文稿和实际示例", "说明使用步骤与限制"],
            executionMode: "ai",
            ownerId: "member-content",
            skills: ["写作"],
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
    .getByRole("button", { name: "创建并自动执行", exact: true })
    .click();
  expect((await request("/workspace")).state.projects).toHaveLength(1);
  expect(calls).toBe(0);
  await start(page, "创建并自动执行");
  await expect(page.getByRole("dialog")).toContainText("从新目标直接自动交付");
  await expect(page.locator(".automation-heading")).toContainText(
    "本批交付已就绪",
  );
  expect(calls).toBe(2);
  expect((await request("/workspace")).state.projects).toHaveLength(2);
});
