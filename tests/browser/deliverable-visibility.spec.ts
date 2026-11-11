import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { readVerifiedZip } from "../helpers/zip.mjs";
import { seedWorkspace } from "../../src/domain";
import { syncDeliveredKnowledge } from "../../shared/knowledge-sync.mjs";

for (const width of [1440, 390]) {
  test(`成果目录、真实文档ZIP、手动收尾与只读知识副本 (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
    const state = seedWorkspace();
    state.projects = [
      {
        ...state.projects[0],
        title: "交付目录回归",
        status: "active",
        deliveryType: "document",
      },
    ];
    state.tasks = [
      {
        ...state.tasks[0],
        title: "最终使用手册",
        status: "done",
        result: "# 完整交付正文\n\n这里是实际交付内容。",
        dependsOn: [],
      },
    ];
    state.knowledge = [];
    await page.addInitScript(
      (state) =>
        localStorage.setItem("ark-workspace-v1", JSON.stringify(state)),
      syncDeliveredKnowledge(state),
    );
    await page.goto("/");
    const saved = () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("ark-workspace-v1")!),
      );
    const openProject = () =>
      page
        .locator(".office-goal-strip")
        .getByRole("button", { name: /交付目录回归/ })
        .click();
    await openProject();
    await expect(page.locator(".closeout-banner")).toContainText(
      "全部任务已完成",
    );
    expect((await saved()).projects[0].status).toBe("active");
    await page.getByRole("button", { name: "成果目录", exact: true }).click();
    await expect(page.locator(".deliverable-index")).toContainText(
      "实际交付内容",
    );
    const downloadEvent = page.waitForEvent("download");
    await page
      .locator(".modal-footer")
      .getByRole("button", { name: "导出任务文档 ZIP", exact: true })
      .click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe("交付目录回归-任务文档.zip");
    const files = await readVerifiedZip(await fs.readFile((await download.path())!));
    expect([...files.keys()]).toEqual(["00-总文档.md", "01-最终使用手册.md"]);
    expect(files.get("01-最终使用手册.md")).toContain("实际交付内容");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/pr1-deliverables-${width}.png`,
      animations: "disabled",
    });
    await page.locator(".deliverable-item").click();
    await expect(
      page.getByRole("heading", { name: "完整交付正文", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    await page.goto("/#knowledge");
    await page
      .locator(".knowledge-card")
      .filter({ hasText: "最终使用手册" })
      .click();
    await expect(page.getByRole("dialog")).toContainText("自动同步的只读副本");
    await expect(
      page.getByRole("button", { name: "保存笔记", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "查看来源任务", exact: true })
      .click();
    await expect(page.getByLabel("任务标题", { exact: true })).toHaveValue(
      "最终使用手册",
    );
    await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    await page.goto("/#dashboard");
    await openProject();
    await page
      .getByRole("button", { name: "标记项目完成", exact: true })
      .click();
    expect((await saved()).projects[0].status).toBe("done");
  });
}
