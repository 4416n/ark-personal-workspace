import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const saved = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("ark-workspace-v1")!));
const current = async (page: Page) =>
  (await saved(page)).tasks.find((t: { id: string }) => t.id === "demo-task-5");
async function openTask(page: Page) {
  await page.goto("/#tasks");
  await page.getByRole("button", { name: "列表视图", exact: true }).click();
  await page
    .getByRole("button", { name: "查看制定第一周内容选题", exact: true })
    .click();
}
async function editResult(page: Page, text: string) {
  await page.getByRole("button", { name: "手动编辑", exact: true }).click();
  await page.getByLabel("任务交付物", { exact: true }).fill(text);
}
async function openRetro(page: Page) {
  await page.goto("/#dashboard");
  await page
    .locator(".office-goal-strip")
    .getByRole("button", { name: /搭建我的个人知识库/ })
    .click();
  await page.getByRole("button", { name: "项目复盘", exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /小舟 的一人公司/ }),
  ).toBeVisible();
});

test("人工保存、版本对照、带未保存修改的恢复和审批完整留存", async ({
  page,
}) => {
  const initial = await current(page);
  await openTask(page);
  await editResult(
    page,
    "## 修订后的内容节奏\n\n- 周二发布知识管理文章\n- 周五分享个人工作流\n\n每篇补充读者画像与案例。 ",
  );
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await openTask(page);
  await page.locator(".delivery-history > summary").click();
  await page.getByRole("button", { name: "对照当前", exact: true }).click();
  await expect(page.locator(".version-preview > section")).toHaveCount(2);
  await expect(page.locator(".version-preview")).toContainText(
    "第一周选题计划（示例）",
  );
  await expect(page.locator(".version-preview")).toContainText(
    "修订后的内容节奏",
  );
  await page.locator(".delivery-history").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/v22-version-desktop.png",
    animations: "disabled",
  });
  await editResult(page, "恢复之前还没保存的草稿");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "恢复为待验收", exact: true }).click();
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  const t = await current(page);
  expect(t.result).toBe(initial.result);
  expect(t.resultMeta.number).toBe(4);
  expect(t.resultHistory.map((v: { content: string }) => v.content)).toContain(
    "恢复之前还没保存的草稿",
  );
  expect(t.status).toBe("review");
  await openTask(page);
  await page.getByRole("button", { name: "验收通过", exact: true }).click();
  expect((await current(page)).reviews[0].versionNumber).toBe(4);
  expect((await current(page)).status).toBe("done");
  await page.reload();
  expect((await current(page)).resultHistory).toEqual(t.resultHistory);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("ark-workspace-v1")!);
    s.tasks.find((t: { id: string }) => t.id === "demo-task-6").dependsOn = [
      "demo-task-5",
    ];
    localStorage.setItem("ark-workspace-v1", JSON.stringify(s));
  });
  await page.reload();
  await openTask(page);
  await editResult(page, "下游仍在进行时尝试修改前置成果");
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("后续任务已启动");
  expect((await current(page)).result).toBe(initial.result);
});

test("生成失败不丢草稿，重试留存原稿与人工稿，历史内容不随请求发送", async ({
  page,
}) => {
  await page.route("**/api/config", (r) =>
    r.fulfill({
      json: {
        configured: true,
        provider: "test",
        model: "test-model",
        baseUrl: "https://example.com/v1",
      },
    }),
  );
  let attempt = 0;
  let request: any;
  await page.route("**/api/execute", (r) => {
    request = r.request().postDataJSON();
    attempt++;
    return r.fulfill(
      attempt === 1
        ? { status: 502, json: { error: "模拟连接失败" } }
        : { json: { content: "# AI 新稿\n补充明确的发布节奏。" } },
    );
  });
  await page.reload();
  const initial = await current(page);
  await openTask(page);
  await editResult(page, "未保存的人工要求");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("模拟连接失败");
  await expect(page.getByLabel("任务交付物", { exact: true })).toHaveValue(
    "未保存的人工要求",
  );
  expect((await current(page)).result).toBe(initial.result);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect(page.getByLabel("任务交付物", { exact: true })).toHaveValue(
    /AI 新稿/,
  );
  expect(
    (await current(page)).resultHistory.map(
      (v: { content: string }) => v.content,
    ),
  ).toEqual(["未保存的人工要求", initial.result]);
  expect(request.task.resultHistory).toBeUndefined();
  expect(request.task.reviews).toBeUndefined();
  let confirmations = 0;
  page.on("dialog", (d) => {
    confirmations++;
    return d.dismiss();
  });
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(confirmations).toBe(0);
});

test("审批中心保留多轮返工的版本与意见，不覆盖前一轮记录", async ({ page }) => {
  for (const feedback of ["补充读者画像", "再补充可操作的案例"]) {
    await page.goto("/#decisions");
    await page.getByLabel("审批意见", { exact: true }).fill(feedback);
    await page.getByRole("button", { name: "退回修改", exact: true }).click();
    await openTask(page);
    await editResult(page, `# 调整成果\n${feedback}`);
    await page
      .getByRole("combobox", { name: "任务状态", exact: true })
      .selectOption("review");
    await page.getByRole("button", { name: "保存任务", exact: true }).click();
  }
  await page.goto("/#decisions");
  await page.locator(".decision-review-trail > summary").click();
  await expect(page.locator(".review-trail")).toContainText("补充读者画像");
  await expect(page.locator(".review-trail")).toContainText(
    "再补充可操作的案例",
  );
  await page.getByRole("button", { name: "验收通过", exact: true }).click();
  expect(
    (await current(page)).reviews.map(
      (r: { action: string; versionNumber: number }) => [
        r.action,
        r.versionNumber,
      ],
    ),
  ).toEqual([
    ["approved", 3],
    ["returned", 2],
    ["returned", 1],
  ]);
});

test("复盘保存、知识沉淀更新、Markdown导出及备份恢复保持一致", async ({
  page,
}) => {
  await openTask(page);
  await editResult(page, "进入备份的新版成果");
  await page.getByRole("button", { name: "验收通过", exact: true }).click();
  await openRetro(page);
  await page
    .getByLabel("实际达成情况", { exact: true })
    .fill("完成分类和工具选型，索引还在建设中。");
  await page
    .getByLabel("可复用经验", { exact: true })
    .fill("先明确验收标准，再安排具体分工。");
  await page
    .getByLabel("下一步行动", { exact: true })
    .fill("用十条真实笔记验证索引是否好用。");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "沉淀到知识库", exact: true }).click();
  await page.getByRole("button", { name: "预览完整复盘", exact: true }).click();
  await expect(page.locator(".retro-preview")).toContainText("通过 0 条");
  await expect(page.locator(".retro-preview")).toContainText("任务完成：2/4");
  await page.getByRole("button", { name: "收起复盘预览", exact: true }).click();
  await page.locator(".project-retrospective").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/v22-retrospective-desktop.png",
    animations: "disabled",
  });
  await page
    .getByRole("textbox", { name: "下一步行动", exact: true })
    .fill("补充搜索入口，并用十条笔记验证。");
  await page
    .getByRole("button", { name: "更新知识库复盘", exact: true })
    .click();
  expect(
    (await saved(page)).knowledge.filter(
      (k: { category: string }) => k.category === "复盘",
    ),
  ).toHaveLength(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出复盘", exact: true }).click();
  expect(await readFile((await (await download).path())!, "utf8")).toContain(
    "补充搜索入口",
  );
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  const before = await saved(page);
  await page.goto("/#settings");
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(before)),
    });
  await page
    .getByRole("button", { name: "确认替换并恢复", exact: true })
    .click();
  await page.reload();
  expect(await saved(page)).toEqual(before);
  await openRetro(page);
  await expect(
    page.getByRole("textbox", { name: "下一步行动", exact: true }),
  ).toHaveValue("补充搜索入口，并用十条笔记验证。");
});

test("手机上的成果对照与复盘保持可读，不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTask(page);
  await editResult(
    page,
    "# 新的选题方向\n\n聚焦真实场景，每周发布两篇实用文章。",
  );
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await openTask(page);
  await page.locator(".delivery-history > summary").click();
  await page.getByRole("button", { name: "对照当前", exact: true }).click();
  await page.locator(".delivery-history > summary").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/v22-version-mobile.png",
    animations: "disabled",
  });
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  const preview = await page.locator(".version-preview").boundingBox();
  expect(preview!.width).toBeLessThan(390);
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await openRetro(page);
  await page
    .getByLabel("可复用经验", { exact: true })
    .fill("先验证最小流程，再逐步完善。");
  await page.getByRole("button", { name: "保存复盘", exact: true }).click();
  await page.locator(".project-retrospective").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/v22-retrospective-mobile.png",
    animations: "disabled",
  });
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
