import { waitForHttp } from "../helpers/http.mjs";
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../../server/index.mjs";
import { seedWorkspace } from "../../src/domain";
import { removeTestDirectory } from "../helpers/filesystem.mjs";

let directory: string, server: Server, base: string, app: ReturnType<typeof createApp>;
test.beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-import-browser-"));
  app = createApp({ shared: true, configPath: path.join(directory, "ai-config.json") });
  server = app.listen(0, "127.0.0.1");
  await waitForHttp(server);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const state = seedWorkspace();
  state.knowledge = [{ id: "guide", title: "品牌指南", content: "保留的原始品牌指南", category: "资料", updatedAt: "2026-11-11T00:00:00.000Z" }];
  await fetch(base + "/api/workspace", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: 0, state }) });
});
test.afterEach(async () => {
  await app.locals.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await removeTestDirectory(directory);
});
const saved = async () => (await (await fetch(base + "/api/workspace")).json()).state;
for (const width of [1440, 390]) test(`批量资料预览、取消、明确替换和来源保留，不调用模型 (${width}px)`, async ({ page }) => {
  const paid: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/(plan|execute|chat|test)$/.test(new URL(request.url()).pathname)) paid.push(request.url());
  });
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
  await page.goto(base + "/#knowledge");
  const files = [
    { name: "品牌指南.md", mimeType: "text/markdown", buffer: Buffer.from("# 新品牌指南\n目标读者：独立开发者。内容使用具体案例。") },
    { name: "产品说明.txt", mimeType: "text/plain", buffer: Buffer.from("产品资料：本地工作台支持项目知识与交付追踪。") },
    { name: "损坏编码.txt", mimeType: "text/plain", buffer: Buffer.from([0xc3, 0x28]) },
  ];
  await page.getByLabel("选择导入资料文件").setInputFiles(files);
  const dialog = page.getByRole("dialog", { name: "核对资料导入" });
  await expect(dialog).toContainText("不是有效的 UTF-8");
  await expect(dialog.getByLabel("处理 品牌指南.md")).toHaveValue("skip");
  expect((await saved()).knowledge).toHaveLength(1);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect((await saved()).knowledge).toHaveLength(1);
  await page.getByLabel("选择导入资料文件").setInputFiles(files);
  await dialog.getByLabel("处理 品牌指南.md").selectOption("replace");
  await expect(dialog).toContainText("其中 1 份替换现有正文");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/knowledge-import-preview-${width}.png`, animations: "disabled" });
  await dialog.getByRole("button", { name: "确认导入 2 份", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await saved()).knowledge.length).toBe(2);
  const state = await saved();
  expect(state.knowledge.find((note: { id: string }) => note.id === "guide").content).toContain("新品牌指南");
  expect(state.knowledge.find((note: { id: string }) => note.id === "guide").sourceFile.name).toBe("品牌指南.md");
  await page.reload();
  await expect(page.locator(".knowledge-grid")).toContainText("来源：品牌指南.md");
  await page.getByLabel("选择导入资料文件").setInputFiles(files.slice(0, 2));
  await expect(dialog).toContainText("正文相同");
  await expect(dialog.getByRole("button", { name: "确认导入 0 份" })).toBeDisabled();
  expect(paid).toEqual([]);
});
