import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import http from "node:http";
import { createApp } from "../../server/index.mjs";
import { lanAddresses } from "../../server/access.mjs";
import { seedWorkspace } from "../../src/domain";

let directory: string,
  server: Server,
  app: ReturnType<typeof createApp>,
  desktop: string,
  mobile: string;
const persisted = async () =>
  (await (await fetch(`${desktop}/api/workspace`)).json()).state;
const localCache = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("ark-workspace-v1")!));
const settle = (page: Page) =>
  expect(page.locator(".sync-status")).toContainText("已保存到电脑");
test.beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-browser-"));
  app = createApp({
    shared: true,
    lan: true,
    configPath: path.join(directory, "ai-config.json"),
  });
  server = app.listen(0, "0.0.0.0");
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  desktop = `http://127.0.0.1:${port}`;
  mobile = `http://${lanAddresses()[0].address}:${port}`;
});
test.afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  app.locals.close();
  await fs.rm(directory, { recursive: true, force: true });
});
async function openTask(page: Page) {
  await page.goto(`${new URL(page.url()).origin}/#tasks`);
  await page.getByRole("button", { name: "列表视图", exact: true }).click();
  await page
    .getByRole("button", { name: "查看制定第一周内容选题", exact: true })
    .click();
}
async function phoneLogin(phone: Page) {
  await phone.goto(mobile);
  await expect(
    phone.getByRole("heading", { name: "把工作台带到手机上" }),
  ).toBeVisible();
  const code = await (
    await fetch(desktop + "/api/connection/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
  ).json();
  await phone.getByLabel("电脑上的连接码").fill(code.code);
  await phone
    .getByRole("button", { name: "连接我的工作台", exact: true })
    .click();
  await expect(
    phone.getByRole("heading", { name: /小舟 的一人公司/ }),
  ).toBeVisible();
}

test("旧浏览器数据迁移到电脑，手机配对后双向编辑共享且支持非安全上下文UUID", async ({
  page,
  browser,
}) => {
  const old = seedWorkspace();
  old.knowledge.push({
    id: "old-note",
    title: "升级前真实笔记",
    content: "这份资料必须保留",
    category: "资料",
    updatedAt: new Date().toISOString(),
  });
  await page.addInitScript((state) => {
    if (!localStorage.getItem("ark-workspace-v1"))
      localStorage.setItem("ark-workspace-v1", JSON.stringify(state));
  }, old);
  await page.goto(desktop);
  await settle(page);
  expect(
    (await persisted()).knowledge.some(
      (k: { id: string }) => k.id === "old-note",
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => !!localStorage.getItem("ark-workspace-v1-before-server-migration"),
    ),
  ).toBe(true);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const phone = await context.newPage();
  await phoneLogin(phone);
  expect(await phone.evaluate(() => isSecureContext)).toBe(false);
  await phone.goto(mobile + "/#knowledge");
  await phone.getByRole("button", { name: "新建笔记", exact: true }).click();
  await phone.getByLabel("笔记标题").fill("手机随手记");
  await phone.getByLabel("笔记内容").fill("在手机写下的项目灵感。");
  await phone.getByRole("button", { name: "保存笔记", exact: true }).click();
  await settle(phone);
  await expect
    .poll(async () =>
      (await localCache(page)).knowledge.some(
        (k: { title: string }) => k.title === "手机随手记",
      ),
    )
    .toBe(true);
  await page.goto(desktop + "/#settings");
  await page.getByLabel("送给自己的话").fill("电脑写下的新目标");
  await page.getByRole("button", { name: "保存资料", exact: true }).click();
  await settle(page);
  await expect
    .poll(async () => (await localCache(phone)).profile.focus)
    .toBe("电脑写下的新目标");
  await page.getByRole("button", { name: "生成连接码", exact: true }).click();
  await page.locator(".connection-panel").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/v30-connection-desktop.png",
    animations: "disabled",
  });
  expect(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await phone.screenshot({
    path: "artifacts/v30-knowledge-phone.png",
    animations: "disabled",
  });
  await context.close();
});

test("电脑和手机同时修改同一任务时提示冲突，用户选择后再同步", async ({
  page,
  browser,
}) => {
  await page.goto(desktop);
  await settle(page);
  const context = await browser.newContext();
  const phone = await context.newPage();
  await phoneLogin(phone);
  await openTask(page);
  await openTask(phone);
  await page.getByRole("button", { name: "手动编辑", exact: true }).click();
  await phone.getByRole("button", { name: "手动编辑", exact: true }).click();
  await page.getByLabel("任务交付物", { exact: true }).fill("电脑保留的成果");
  await phone
    .getByLabel("任务交付物", { exact: true })
    .fill("手机还在修改的成果");
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await settle(page);
  await phone.getByRole("button", { name: "保存任务", exact: true }).click();
  await expect(phone.locator(".sync-status")).toContainText(
    "两台设备修改了相同内容",
  );
  expect(
    (await persisted()).tasks.find(
      (t: { id: string }) => t.id === "demo-task-5",
    ).result,
  ).toBe("电脑保留的成果");
  phone.once("dialog", (d) => d.accept());
  await phone
    .getByRole("button", { name: "使用电脑最新版", exact: true })
    .click();
  await settle(phone);
  expect(
    (await localCache(phone)).tasks.find(
      (t: { id: string }) => t.id === "demo-task-5",
    ).result,
  ).toBe("电脑保留的成果");
  await context.close();
});

test("已打开页面断网编辑暂存，恢复网络自动同步；删除后可从快照恢复", async ({
  page,
}) => {
  await page.goto(desktop);
  await settle(page);
  await page.route("**/api/workspace**", (r) => r.abort());
  await page.goto(desktop + "/#knowledge");
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByLabel("笔记标题").fill("暂存的灵感");
  await page.getByLabel("笔记内容").fill("网络恢复后同步。");
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(page.locator(".sync-status")).toContainText("修改暂存本机");
  expect(
    await page.evaluate(
      () => !!localStorage.getItem("ark-workspace-pending-v3"),
    ),
  ).toBe(true);
  await page.unroute("**/api/workspace**");
  await settle(page);
  expect(
    (await persisted()).knowledge.some(
      (k: { title: string }) => k.title === "暂存的灵感",
    ),
  ).toBe(true);
  await page
    .locator(".knowledge-card")
    .filter({ hasText: "暂存的灵感" })
    .click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除笔记", exact: true }).click();
  await settle(page);
  await page.goto(desktop + "/#settings");
  await page.locator(".backup-list > button").first().click();
  await expect(
    page.getByRole("dialog", { name: "预览恢复内容" }),
  ).toContainText("恢复为 2");
  await page.getByRole("button", { name: "确认恢复这份快照" }).click();
  await settle(page);
  await expect(page.getByRole("dialog", { name: "预览恢复内容" })).toHaveCount(
    0,
  );
  await settle(page);
  expect(
    (await persisted()).knowledge.some(
      (k: { title: string }) => k.title === "暂存的灵感",
    ),
  ).toBe(true);
});

test("项目知识可检索，流程模板能预览分工并创建全新项目", async ({ page }) => {
  await page.goto(desktop);
  await settle(page);
  await page.goto(desktop + "/#knowledge");
  await page.getByRole("button", { name: "新建笔记" }).click();
  await page.getByLabel("笔记标题").fill("知识库索引规范");
  await page
    .getByLabel("笔记内容")
    .fill("知识库索引统一采用主题、项目、时间三个维度组织。每条笔记保留出处。");
  await page.getByLabel("知识所属项目").selectOption("demo-knowledge");
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await settle(page);
  await page.getByLabel("检索项目范围").selectOption("demo-knowledge");
  await page.getByLabel("你要找什么").fill("知识库索引规范");
  await page.getByRole("button", { name: "检索资料", exact: true }).click();
  await page.locator(".rag-sources > summary").click();
  await expect(page.locator(".rag-sources")).toContainText("三个维度组织");
  await page.screenshot({
    path: "artifacts/v30-rag-desktop.png",
    fullPage: true,
  });
  await page.goto(desktop);
  await page
    .locator(".office-goal-strip")
    .getByRole("button", { name: /搭建我的个人知识库/ })
    .click();
  page.once("dialog", (d) => d.accept("知识库标准流程"));
  await page
    .getByRole("button", { name: "保存为流程模板", exact: true })
    .click();
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await settle(page);
  await page.goto(desktop + "/#projects");
  await page.getByRole("button", { name: /流程模板/ }).click();
  await page
    .locator(".template-list")
    .getByRole("button", { name: /知识库标准流程/ })
    .first()
    .click();
  await page.getByLabel("新项目名称").fill("从模板开始的第二个知识库");
  await page.getByRole("button", { name: "预览排期与分工" }).click();
  await expect(page.locator(".template-preview > div")).toHaveCount(4);
  await page.screenshot({
    path: "artifacts/v30-template-desktop.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "确认创建项目", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "从模板开始的第二个知识库",
  );
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await settle(page);
  const s = await persisted(),
    project = s.projects.find(
      (p: { title: string }) => p.title === "从模板开始的第二个知识库",
    );
  expect(
    s.tasks
      .filter((t: { projectId: string }) => t.projectId === project.id)
      .every(
        (t: { status: string; result: string }) =>
          t.status === "todo" && !t.result,
      ),
  ).toBe(true);
});

test("执行面板展示失败原因、可重试并保存结果，也能取消正在生成的请求", async ({
  page,
}) => {
  let mode = "fail";
  const upstream = http
    .createServer(async (req, res) => {
      for await (const _chunk of req) {
        /* consume body */
      }
      res.setHeader("Content-Type", "application/json");
      if (mode === "wait") return;
      if (mode === "fail") {
        res.writeHead(429);
        res.end(JSON.stringify({ error: "rate" }));
        return;
      }
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "# 重新执行后的选题\n每周两篇，围绕知识管理与个人工作流。",
              },
            },
          ],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 40,
            total_tokens: 160,
          },
        }),
      );
    })
    .listen(0, "127.0.0.1");
  await new Promise((r) => upstream.once("listening", r));
  try {
    await fetch(desktop + "/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "test",
        baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`,
        model: "test-model",
        apiKey: "test-key-only",
      }),
    });
    await page.goto(desktop);
    await settle(page);
    await openTask(page);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "重新生成", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "额度不足或请求频率过高",
    );
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await page.goto(desktop + "/#runs");
    await expect(page.locator(".run-list")).toContainText("失败");
    await page.locator(".run-main").first().click();
    mode = "success";
    await page.getByRole("button", { name: "重新执行", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "重新执行后的选题" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("合计 160 tokens");
    await page.screenshot({
      path: "artifacts/v30-run-detail.png",
      animations: "disabled",
    });
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "保存到原任务", exact: true })
      .click();
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await settle(page);
    expect(
      (await persisted()).tasks.find(
        (t: { id: string }) => t.id === "demo-task-5",
      ).result,
    ).toContain("重新执行后的选题");
    mode = "wait";
    await openTask(page);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "重新生成", exact: true }).click();
    await page.getByRole("button", { name: "取消生成", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("已取消生成");
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await page.goto(desktop + "/#runs");
    await expect(page.locator(".run-list")).toContainText("已取消");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "artifacts/v30-runs-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    upstream.closeAllConnections();
    await new Promise((r) => upstream.close(r));
  }
});
