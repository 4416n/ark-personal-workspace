import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../../server/index.mjs";
import { hashPassword } from "../../server/deployment.mjs";
import { waitForHttp, blockedHttpPorts } from "../helpers/http.mjs";
import { removeTestDirectory } from "../helpers/filesystem.mjs";
import { createServer } from "node:net";

test("reminder center opens pending approvals, persists read state and fits a phone", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "查看工作台动态", exact: true }).click();
  const center = page.getByRole("dialog", { name: "工作台动态", exact: true });
  await expect(center.getByText("待验收", { exact: true })).toBeVisible();
  await center.getByRole("button", { name: "全部标为已读", exact: true }).click();
  await expect(page.locator(".notice-count")).toHaveCount(0);
  await center.getByRole("button", { name: /制定第一周内容选题/ }).click();
  await expect(page.getByRole("dialog")).toContainText("第一周选题计划");
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.reload();
  await expect(page.locator(".notice-count")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "查看工作台动态", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "工作台动态" })).toBeVisible();
  expect(await page.getByRole("dialog", { name: "工作台动态" }).evaluate((element) => element.closest(".topbar") === null)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/release-reminders-mobile.png", animations: "disabled" });
});

test("password login initializes remote workspace, saves edits, logs out and protects data", async ({ page }) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-remote-browser-"));
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await waitForHttp(probe, blockedHttpPorts);
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const password = "browser-workspace-password";
  const app = createApp({ shared: true, configPath: path.join(directory, "ai.json"), deployment: { publicOrigin: origin, passwordHash: await hashPassword(password) } });
  const server = app.listen(port, "127.0.0.1");
  await waitForHttp(server);
  try {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await expect(page.getByRole("heading", { name: "登录你的工作台" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("ark-workspace-v1"))).toBeNull();
    await page.getByLabel("工作台密码", { exact: true }).fill("incorrect-password");
    await page.getByRole("button", { name: "登录工作台", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("密码不正确");
    await page.getByLabel("工作台密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录工作台", exact: true }).click();
    await expect(page.getByRole("button", { name: "拆解新目标", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "工作台设置", exact: true }).click();
    await expect(page.getByRole("heading", { name: "远程工作台", exact: true })).toBeVisible();
    await page.getByLabel("你的名字", { exact: true }).fill("远程使用者");
    await page.getByRole("button", { name: "保存资料", exact: true }).click();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(page.getByRole("heading", { name: "登录你的工作台" })).toBeVisible();
    expect((await page.request.get(`${origin}/api/workspace`)).status()).toBe(401);
    await page.getByLabel("工作台密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录工作台", exact: true }).click();
    await expect(page.getByLabel("你的名字", { exact: true })).toHaveValue("远程使用者");
    await expect(page.locator(".sync-status")).toContainText("已保存到服务器");
    await expect(page.getByRole("heading", { name: "完整迁移备份", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "工程验证环境", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    await page.screenshot({ path: "artifacts/release-remote-settings.png", fullPage: true, animations: "disabled" });
  } finally {
    await page.goto("about:blank");
    await app.locals.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await removeTestDirectory(directory);
  }
});
