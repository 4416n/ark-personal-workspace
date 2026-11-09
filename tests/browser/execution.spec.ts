import { test, expect, type Page } from "@playwright/test";
const saved = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("ark-workspace-v1")!));
async function withDependencies(page: Page) {
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("ark-workspace-v1")!);
    s.tasks.find((t: { id: string }) => t.id === "demo-task-1").dependsOn = [
      "demo-task-0",
    ];
    s.tasks.find((t: { id: string }) => t.id === "demo-task-2").dependsOn = [
      "demo-task-1",
    ];
    s.tasks.find((t: { id: string }) => t.id === "demo-task-3").dependsOn = [
      "demo-task-2",
    ];
    localStorage.setItem("ark-workspace-v1", JSON.stringify(s));
  });
  await page.reload();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /小舟 的一人公司/ }),
  ).toBeVisible();
});

test("项目聚焦联动行动队列、部门与工位，刷新保留视图且不改业务数据", async ({
  page,
}) => {
  const before = await saved(page);
  await page
    .getByRole("combobox", { name: "办公室聚焦项目" })
    .selectOption("demo-knowledge");
  await expect(page.locator(".action-item")).toHaveCount(2);
  await expect(page.locator(".action-queue")).toContainText(
    "搭建知识库目录与索引",
  );
  await expect(page.locator(".action-queue")).not.toContainText(
    "制定第一周内容选题",
  );
  await expect(page.locator(".room-3")).toHaveClass(/outside-focus/);
  await page
    .locator(".office-mode-tabs")
    .getByRole("button", { name: "负载", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "办公室聚焦项目" }),
  ).toHaveValue("demo-knowledge");
  await expect(
    page
      .locator(".office-mode-tabs")
      .getByRole("button", { name: "负载", exact: true }),
  ).toHaveClass("active");
  expect(await saved(page)).toEqual(before);
  await page.getByRole("button", { name: "清除聚焦" }).click();
  await expect(page.locator(".department-room.outside-focus")).toHaveCount(0);
  await expect(page.locator(".action-item").first()).toContainText(
    "制定第一周内容选题",
  );
  await page.screenshot({
    path: "artifacts/v21-office.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("队列解释阻塞与暂停，不把暂停项目推荐为下一步", async ({ page }) => {
  await withDependencies(page);
  await page
    .locator(".action-tabs")
    .getByRole("button", { name: "有阻塞", exact: true })
    .click();
  await expect(page.locator(".action-queue")).toContainText(
    "设计每周知识整理流程",
  );
  await expect(page.locator(".action-queue")).toContainText(
    "先完成：搭建知识库目录与索引",
  );
  await page
    .locator(".action-item")
    .filter({ hasText: "设计每周知识整理流程" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("等待前置");
  await page
    .getByRole("button", {
      name: "查看前置任务搭建知识库目录与索引",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("任务标题", { exact: true })).toHaveValue(
    "搭建知识库目录与索引",
  );
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("ark-workspace-v1")!);
    s.projects.find((p: { id: string }) => p.id === "demo-content").status =
      "paused";
    localStorage.setItem("ark-workspace-v1", JSON.stringify(s));
  });
  await page.reload();
  await expect(page.locator(".next-action-bar")).not.toContainText(
    "制定第一周内容选题",
  );
  await page
    .getByRole("combobox", { name: "办公室聚焦项目" })
    .selectOption("demo-content");
  await expect(page.locator(".next-action-bar")).toHaveCount(0);
  await expect(page.locator(".action-queue")).toContainText("当前没有待办");
});

test("员工工作面板暂停/恢复接单并直达任务，不发起自动模型请求", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/execute", (r) => {
    calls++;
    return r.abort();
  });
  await page
    .getByRole("button", { name: "查看小码的工作面板", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "小码的工作面板" }),
  ).toContainText("搭建知识库目录与索引");
  await page.getByRole("button", { name: "暂停接单", exact: true }).click();
  await expect(page.locator(".staff-task-list")).toContainText("员工暂停");
  expect(
    (await saved(page)).members.find(
      (m: { id: string }) => m.id === "member-tech",
    ).availability,
  ).toBe("paused");
  await page.getByRole("button", { name: "恢复接单", exact: true }).click();
  await page.screenshot({
    path: "artifacts/v21-staff.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .locator(".staff-task-list")
    .getByRole("button", { name: /搭建知识库目录与索引/ })
    .click();
  await expect(page.getByLabel("任务标题", { exact: true })).toHaveValue(
    "搭建知识库目录与索引",
  );
  expect(calls).toBe(0);
});

test("协作路线映射真实依赖，编辑前置关系拒绝循环且刷新保留", async ({
  page,
}) => {
  await withDependencies(page);
  await page
    .locator(".office-goal-strip")
    .getByRole("button", { name: /搭建我的个人知识库/ })
    .click();
  await page.getByRole("button", { name: "协作路线", exact: true }).click();
  await expect(page.locator(".route-stage")).toHaveCount(4);
  await expect(page.locator(".route-task")).toHaveCount(4);
  await expect(page.locator(".project-route")).toContainText("共 3 条前置关系");
  await page.screenshot({
    path: "artifacts/v21-route.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .locator(".route-task")
    .filter({ hasText: "搭建知识库目录与索引" })
    .click();
  await page.locator(".dependency-editor > summary").click();
  await expect(
    page.getByRole("checkbox", { name: /设计每周知识整理流程/ }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /梳理知识分类与使用场景/ }).check();
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await page.reload();
  const task = (await saved(page)).tasks.find(
    (t: { id: string }) => t.id === "demo-task-2",
  );
  expect(task.dependsOn).toEqual(["demo-task-1", "demo-task-0"]);
});

test("全屏打开工位会退出全屏，关闭未保存任务先确认", async ({ page }) => {
  await page
    .getByRole("button", { name: "全屏查看办公室", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await page
    .getByRole("button", { name: "查看小策的工作面板", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "小策的工作面板" }),
  ).toBeVisible();
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page
    .locator(".staff-task-list")
    .getByRole("button", { name: /梳理个人品牌关键词/ })
    .click();
  await page.getByLabel("任务标题", { exact: true }).fill("尚未保存的新标题");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await expect(page.getByRole("dialog", { name: "任务详情" })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  expect(
    (await saved(page)).tasks.find(
      (t: { id: string }) => t.id === "demo-task-8",
    ).title,
  ).toBe("梳理个人品牌关键词");
});

test("手机上的员工面板、行动队列和路线图不造成页面横向溢出", async ({
  page,
}) => {
  await withDependencies(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.screenshot({
    path: "artifacts/v21-mobile-office.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.locator(".brief-member").filter({ hasText: "小码" }).click();
  await expect(
    page.getByRole("dialog", { name: "小码的工作面板" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/v21-mobile-staff.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page
    .locator(".office-goal-strip")
    .getByRole("button", { name: /搭建我的个人知识库/ })
    .click();
  await page.getByRole("button", { name: "协作路线", exact: true }).click();
  await page.screenshot({
    path: "artifacts/v21-mobile-route.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".route-scroll")).toBeVisible();
});
