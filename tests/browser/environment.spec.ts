import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../../server/index.mjs";
import { diagnoseSandbox } from "../../server/project-sandbox.mjs";
import { removeTestDirectory } from "../helpers/filesystem.mjs";

let directory: string,
  server: Server,
  app: ReturnType<typeof createApp>,
  base: string;

test.beforeEach(async () => {
  directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "ark-environment-browser-"),
  );
  app = createApp({
    shared: true,
    configPath: path.join(directory, "ai-config.json"),
    softwareOptions: {
      capability: () =>
        diagnoseSandbox({ platform: "win32", nodeVersion: "24.0.0" }),
    },
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterEach(async () => {
  await app.locals.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await removeTestDirectory(directory);
});

for (const width of [1440, 390]) {
  test(`工程环境检查说明平台限制并可重新检查，不发模型请求 (${width}px)`, async ({
    page,
  }) => {
    const paidRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "POST" &&
        /\/api\/(plan|execute|chat|test|software\/.*\/start)$/.test(
          url.pathname,
        )
      )
        paidRequests.push(url.pathname);
    });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
    await page.goto(base + "/#settings");
    const panel = page.getByRole("region", {
      name: "工程验证环境",
      exact: true,
    });
    await expect(panel).toContainText("当前只能交付未验证源码");
    await expect(panel).toContainText("Windows 暂不支持自动隔离验证");
    await expect(panel).toContainText(
      "基础工作台与文档任务不受工程验证环境限制",
    );
    await expect(
      panel.getByRole("list", { name: "工程环境检查项" }).getByRole("listitem"),
    ).toHaveCount(7);
    const refreshed = page.waitForResponse((response) =>
      response.url().endsWith("/api/software-capabilities?refresh=1"),
    );
    await panel
      .getByRole("button", { name: "重新检查环境", exact: true })
      .click();
    expect((await refreshed).ok()).toBe(true);
    await expect(
      panel.getByRole("button", { name: "重新检查环境", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await panel.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect(paidRequests).toEqual([]);
  });
}
