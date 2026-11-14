import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../../server/index.mjs";
import { stagedResponse } from "../fixtures/staged.mjs";
import { waitForHttp } from "../helpers/http.mjs";
import { removeTestDirectory } from "../helpers/filesystem.mjs";
import { VERIFICATION_VERSION } from "../../server/scaffold/scripts/persistence.mjs";

test("full automatic entry shows missing prerequisites and fits a mobile screen", async ({ page }) => {
  await page.goto("/#autopilot");
  await expect(page.getByRole("heading", { name: "全自动交付", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "全自动开发并部署", exact: true })).toBeDisabled();
  await expect(page.getByText("先连接一次 AI 模型。", { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/autopilot-phone.png", fullPage: true, animations: "disabled" });
});

test("enter goal once and receive a deployed application without stage confirmation dialogs", async ({ page }) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-autopilot-browser-"));
  const upstream = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const content = body.messages[0].content.includes("全自动网站交付规划师")
      ? JSON.stringify({ tasks: [{ title: "笔记读写", description: "新增和查询笔记", skills: ["开发"] }] })
      : stagedResponse(body);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  }).listen(0, "127.0.0.1");
  await waitForHttp(upstream);
  const app = createApp({ shared: true, configPath: path.join(directory, "ai-config.json"), autopilotOptions: {
    runtime: {
      capability: async () => ({ available: true, reason: "Docker 模拟环境，仅用于自动化页面测试" }),
      validate: async () => ({ passed: true, driver: "docker", verificationVersion: VERIFICATION_VERSION, coverage: { browser: true }, checks: [{ name: "模拟动态检查", passed: true, detail: "test" }], logs: "mock" }),
      buildImage: async () => {}, network: async () => {}, createVolume: async () => {}, startContainer: async () => "http://127.0.0.1:8800", health: async () => {}, removeContainer: async () => {}, command: async () => "",
    },
    jobOptions: { pollMs: 20, retryDelayMs: 10 },
    releaseOptions: { monitorMs: 600000, fetcher: async () => ({ status: 200 }) },
  } });
  const server = app.listen(0, "127.0.0.1"); await waitForHttp(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await page.goto(base + "/#autopilot");
    await expect(page.getByRole("heading", { name: "全自动交付", exact: true })).toBeVisible();
    await page.request.post(base + "/api/config", { data: { provider: "mock", model: "mock", apiKey: "TEST-ONLY", baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1` } });
    await page.reload();
    await page.getByLabel("应用名称", { exact: true }).fill("我的自动笔记应用");
    await page.getByLabel("自动交付目标", { exact: true }).fill("做一个可以新增和查询笔记的网站，数据保存在 SQLite");
    await page.getByLabel("可检查的验收标准", { exact: true }).fill("新增笔记后刷新和重启均能读回");
    let dialogs = 0;
    page.on("dialog", async (dialog) => { dialogs++; await dialog.dismiss(); });
    await page.getByRole("button", { name: "全自动开发并部署", exact: true }).click();
    await expect(page.locator(".autopilot-job").getByText("已部署", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "打开应用", exact: true })).toHaveAttribute("href", "http://127.0.0.1:8800");
    expect(dialogs).toBe(0);
    await page.reload();
    await expect(page.locator(".autopilot-job").getByText("已部署", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "artifacts/autopilot-completed-phone.png", fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "工程与测试证据", exact: true }).click();
    await expect(page.getByText("本版使用 Docker 实测", { exact: false })).toBeVisible();
    await expect(page.getByText("Docker 镜像构建结果见实际检查", { exact: false })).toBeVisible();
  } finally {
    await page.goto("about:blank");
    await app.locals.close(); server.closeAllConnections(); upstream.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await removeTestDirectory(directory);
  }
});
