import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { createApp } from "../../server/index.mjs";
import { openDatabase } from "../../server/database.mjs";
import { seedWorkspace } from "../../src/domain";
import { assembleBundle, sourceHash } from "../../server/project-bundle.mjs";
import { requirements, requirementsHash } from "../../server/requirements.mjs";
import { fullstackFixture } from "../fixtures/fullstack.mjs";
import { removeTestDirectory } from "../helpers/filesystem.mjs";
let dir: string,
  base: string,
  server: Server,
  app: ReturnType<typeof createApp>,
  buildId: string;
const snapshot = async () =>
  await (await fetch(base + "/api/workspace")).json();
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-backup-browser-"));
  const db = openDatabase(dir),
    s = seedWorkspace();
  s.profile.name = "备份前的我";
  s.projects = [
    { ...s.projects[0], title: "备份演示工程", deliveryType: "software" },
  ];
  s.tasks = s.tasks.filter((t) => t.projectId === s.projects[0].id);
  s.knowledge = [];
  db.save(s, 0);
  const files = await assembleBundle(fullstackFixture());
  buildId = randomUUID();
  db.saveBuild({
    id: buildId,
    projectId: s.projects[0].id,
    title: "备份演示工程",
    status: "verified",
    startedAt: new Date().toISOString(),
    summary: "可恢复的源码",
    files,
    sourceHash: sourceHash(files),
    requirementsHash: requirementsHash(
      requirements(db.read().state, s.projects[0].id),
    ),
    requirementsVersion: 2,
    attempts: [],
    validation: { passed: true, checks: [], logs: "fixture only" },
    pinned: true,
  });
  db.close();
  await fs.writeFile(
    path.join(dir, "ai-config.json"),
    JSON.stringify({
      apiKey: "PRIVATE-FIXTURE-ONLY",
      provider: "mock",
      model: "mock",
    }),
  );
  app = createApp({
    shared: true,
    configPath: path.join(dir, "ai-config.json"),
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await app.locals.close();
  await removeTestDirectory(dir);
});
for (const width of [1440, 390]) {
  test(`完整备份下载、预览、取消和确认恢复，工程标明待重验 (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
    await page.goto(base + "/#settings");
    await expect(
      page.getByRole("button", { name: "下载完整备份", exact: true }),
    ).toBeVisible();
    const downloaded = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "下载完整备份", exact: true })
      .click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toContain(".arkbackup.gz");
    const filePath = (await file.path())!;
    const current = await snapshot();
    current.state.profile.name = "导出后新名字";
    await fetch(base + "/api/workspace", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(current),
    });
    await page.reload();
    await page.getByLabel("完整备份文件").setInputFiles(filePath);
    await expect(
      page.getByRole("dialog", { name: "核对完整备份" }),
    ).toBeVisible();
    await expect(page.locator(".backup-counts")).toContainText("工程版本");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".modal")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/full-backup-${width}.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "取消", exact: true }).click();
    expect((await snapshot()).state.profile.name).toBe("导出后新名字");
    await page.getByLabel("完整备份文件").setInputFiles(filePath);
    await expect(
      page.getByRole("dialog", { name: "核对完整备份" }),
    ).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "备份当前数据并恢复", exact: true })
      .click();
    await expect
      .poll(async () => (await snapshot()).state.profile.name)
      .toBe("备份前的我");
    await expect(page.locator(".sync-status")).toContainText("已保存到电脑");
    const restored = await (
      await fetch(base + `/api/software-builds/${buildId}`)
    ).json();
    expect(restored.status).toBe("restored");
    expect(restored.validation).toBeNull();
    expect((await fs.readdir(path.join(dir, "full-backups"))).length).toBe(1);
    expect(
      await fs.readFile(path.join(dir, "ai-config.json"), "utf8"),
    ).toContain("PRIVATE-FIXTURE-ONLY");
    await page.goto(base + "/#projects");
    await page.getByRole("button", { name: /备份演示工程.*项目进度/ }).click();
    await expect(
      page.getByRole("button", { name: "解除版本锁定", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".software-panel")).toContainText("备份恢复");
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "解除版本锁定", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "锁定重要版本", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "锁定重要版本", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "解除版本锁定", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".software-panel")).toContainText(
      "已锁定，不随普通历史清理",
    );
  });
}
test("完整备份上传损坏文件后清晰报错，不影响现有数据", async ({ page }) => {
  const before = await snapshot();
  await page.goto(base + "/#settings");
  await page
    .getByLabel("完整备份文件")
    .setInputFiles({
      name: "broken.arkbackup.gz",
      mimeType: "application/gzip",
      buffer: Buffer.from("corrupted"),
    });
  await expect(page.getByRole("alert")).toContainText("备份无法解压");
  expect(await snapshot()).toEqual(before);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("备份容量展示并重新核对旧快照，取消不整理，确认提交最新版本", async ({ page }) => {
  const mib = 1024 * 1024;
  const response = await fetch(base + "/api/storage-status");
  expect(response.ok).toBe(true);
  const current = await response.json();
  let revision = 7;
  const status = () => ({
    ...current,
    revision,
    tables: {
      ...current.tables,
      snapshots: { count: 3, bytes: 30 * mib },
    },
    fullBackup: {
      ...current.fullBackup,
      logicalBytes: 33 * mib,
    },
    snapshots: {
      ...current.snapshots,
      retainedCount: 2,
      retainedBytes: 20 * mib,
      prunableCount: 1,
      prunableBytes: 10 * mib,
    },
  });
  const requests: unknown[] = [];
  await page.route("**/api/storage-status", (route) => route.fulfill({ json: status() }));
  await page.route("**/api/snapshots/prune", (route) => {
    requests.push(route.request().postDataJSON());
    const next = status();
    next.tables.snapshots = { count: 2, bytes: 20 * mib };
    next.fullBackup.logicalBytes = 23 * mib;
    next.snapshots.prunableCount = 0;
    next.snapshots.prunableBytes = 0;
    return route.fulfill({
      json: { ok: true, removedCount: 1, removedBytes: 10 * mib, status: next },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/#settings");
  const capacity = page.getByRole("region", { name: "备份容量", exact: true });
  await expect(capacity).toContainText("33.0 MiB");
  await expect(capacity).toContainText("当前 3 份快照");
  expect(requests).toHaveLength(0);
  await capacity.getByRole("button", { name: "整理旧快照", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "整理旧快照", exact: true });
  await expect(confirmation).toContainText("保留最近 2 份");
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  expect(requests).toHaveLength(0);

  // A changed revision must be fetched for the new confirmation, not reused
  // from the initial capacity display or the cancelled dialog.
  revision = 8;
  await capacity.getByRole("button", { name: "整理旧快照", exact: true }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "确认整理", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect(requests).toEqual([{
    confirmed: true,
    revision: 8,
    snapshotFingerprint: current.snapshots.fingerprint,
  }]);
  await expect(capacity).toContainText("已整理 1 份旧快照");
  await expect(capacity).toContainText("23.0 MiB");
  await expect(capacity.getByRole("button", { name: "整理旧快照", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
