import { waitForHttp } from "../helpers/http.mjs";
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../../server/index.mjs";
import { openDatabase } from "../../server/database.mjs";
import { seedPreview, previewFrame } from "../fixtures/preview.mjs";
import { removeTestDirectory } from "../helpers/filesystem.mjs";
let directory: string,
  base: string,
  server: Server,
  app: ReturnType<typeof createApp>,
  closed: boolean;
let actions: { type: string; value?: string }[];
test.beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-preview-browser-"));
  const db = openDatabase(directory);
  await seedPreview(db);
  db.close();
  closed = false;
  actions = [];
  app = createApp({
    shared: true,
    configPath: path.join(directory, "ai-config.json"),
    softwareOptions: {
      capability: async () => ({
        available: true,
        reason: "mock UI environment",
      }),
    },
    previewOptions: {
      capability: async () => ({ available: true }),
      launcher: async () => ({
        frame: previewFrame(),
        alive: () => !closed,
        close: async () => {
          closed = true;
        },
        request: async (action: {
          type: string;
          value?: string;
          mode?: string;
        }) => {
          actions.push(action);
          return action.mode === "mobile"
            ? previewFrame(390, 844)
            : previewFrame();
        },
      }),
    },
  });
  server = app.listen(0, "127.0.0.1");
  await waitForHttp(server);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterEach(async () => {
  await app.locals.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await removeTestDirectory(directory);
});
for (const width of [1440, 390])
  test(`安全预览只显示PNG并可点击输入、切换手机和停止 (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
    await page.goto(base + "/#projects");
    await page
      .getByRole("button", { name: /安全预览测试工程.*项目进度/ })
      .click();
    const preview = page.getByRole("region", {
      name: "安全交互预览",
      exact: true,
    });
    await expect(
      preview.getByRole("button", { name: "启动安全预览" }),
    ).toBeEnabled();
    page.once("dialog", (dialog) => dialog.accept());
    await preview.getByRole("button", { name: "启动安全预览" }).click();
    await expect(
      preview.getByRole("img", { name: "隔离浏览器的当前画面" }),
    ).toBeVisible();
    expect(await preview.locator("img").getAttribute("src")).toMatch(
      /^data:image\/png;base64,/,
    );
    await expect(preview.locator("iframe")).toHaveCount(0);
    await preview.getByRole("button", { name: "下一输入框" }).click();
    await preview.getByLabel("预览输入文字").fill("mock preview text");
    await preview.getByRole("button", { name: "发送文字" }).click();
    await expect(preview.getByLabel("预览输入文字")).toHaveValue("");
    expect(
      actions.some(
        (action) =>
          action.type === "text" && action.value === "mock preview text",
      ),
    ).toBe(true);
    await preview.getByRole("button", { name: "手机", exact: true }).click();
    await expect(preview.locator("img")).toHaveAttribute("width", "390");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await preview.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await preview.getByRole("button", { name: "停止预览" }).click();
    await expect(
      preview.getByRole("button", { name: "启动安全预览" }),
    ).toBeVisible();
    expect(closed).toBe(true);
  });

test("停止请求失败保留会话，用户可重试确认清理", async ({ page }) => {
  await page.goto(base + "/#projects");
  await page
    .getByRole("button", { name: /安全预览测试工程.*项目进度/ })
    .click();
  const preview = page.getByRole("region", {
    name: "安全交互预览",
    exact: true,
  });
  page.once("dialog", (dialog) => dialog.accept());
  await preview.getByRole("button", { name: "启动安全预览" }).click();
  await expect(preview.getByRole("button", { name: "停止预览" })).toBeVisible();
  await page.route("**/api/previews/*", (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 503, json: { error: "清理暂时无法确认" } })
      : route.continue(),
  );
  await preview.getByRole("button", { name: "停止预览" }).click();
  await expect(preview.getByRole("alert")).toContainText("请重试停止");
  await expect(preview.getByRole("button", { name: "停止预览" })).toBeEnabled();
  expect(closed).toBe(false);
  await page.unroute("**/api/previews/*");
  await preview.getByRole("button", { name: "停止预览" }).click();
  await expect(
    preview.getByRole("button", { name: "启动安全预览" }),
  ).toBeVisible();
  expect(closed).toBe(true);
});
