import { test, expect, type Page } from "@playwright/test";
const saved = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("ark-workspace-v1")!));
const nav = (page: Page, name: string) =>
  page.locator(".sidebar").getByRole("button", { name, exact: true }).click();
const config = {
  configured: true,
  provider: "test",
  model: "test-model",
  baseUrl: "https://example.com/v1",
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /小舟 的一人公司/ }),
  ).toBeVisible();
});

test("办公室工位、部门档案、缩放与能力模式真实联动", async ({ page }) => {
  const first = await page.locator(".office-floor").boundingBox();
  await page.getByRole("button", { name: "放大办公室", exact: true }).click();
  await expect
    .poll(
      async () => (await page.locator(".office-floor").boundingBox())!.width,
    )
    .toBeGreaterThan(first!.width);
  await page.getByRole("button", { name: "重置办公室缩放" }).click();
  await page
    .locator(".office-mode-tabs")
    .getByRole("button", { name: "负载", exact: true })
    .click();
  await expect(page.locator(".desk-task-badge").first()).toContainText("40h");
  await page.locator(".room-heading").first().click();
  await expect(
    page.getByRole("dialog", { name: "策略部", exact: true }),
  ).toContainText("部门任务");
  await page.getByRole("button", { name: "编辑部门" }).click();
  await page.getByLabel("部门职责").fill("负责目标与里程碑，产出验收标准。");
  await page
    .getByRole("combobox", { name: "部门负责人", exact: true })
    .selectOption("member-strategy");
  await page.getByRole("button", { name: "保存部门" }).click();
  await page
    .locator(".desk")
    .filter({ has: page.locator(".desk-name", { hasText: "小策" }) })
    .click();
  await expect(
    page.getByRole("dialog", { name: "小策的工作面板" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "编辑档案", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "认识小策" })).toBeVisible();
  await page.getByLabel("工作风格标签").fill("结构化，重证据");
  await page.getByRole("slider", { name: "调研技能等级" }).fill("5");
  await page.getByRole("button", { name: "保存员工" }).click();
  await page.reload();
  const data = await saved(page);
  expect(data.departments[0].mission).toContain("验收标准");
  expect(data.members[0].skillLevels.调研).toBe(5);
  expect(data.members[0].traits).toEqual(["结构化", "重证据"]);
});

test("新部门、角色招募、暂停接单和员工名册追加导入", async ({ page }) => {
  await nav(page, "团队");
  await page.getByRole("button", { name: "新建部门", exact: true }).click();
  await page.getByLabel("部门名称", { exact: true }).fill("个人实验室");
  await page.getByRole("button", { name: "保存部门" }).click();
  await expect(
    page.locator(".org-dept").filter({ hasText: "个人实验室" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "角色库", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /小研/ }).click();
  await page.getByRole("button", { name: "加入我的公司" }).click();
  await page.getByRole("button", { name: "暂停小研接单" }).click();
  await expect(
    page.getByRole("button", { name: "恢复小研接单" }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出员工名册" }).click();
  const path = await (await downloadPromise).path();
  await page.locator("input[type=file]").setInputFiles(path!);
  await expect(
    page.getByRole("dialog", { name: "导入员工名册" }),
  ).toContainText("将新增 5 位员工");
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  expect((await saved(page)).members).toHaveLength(10);
  await nav(page, "办公室");
  await expect(page.locator(".extra-rooms")).toContainText("研究部");
});

test("一句话目标预填，暂停员工不自动接单，依赖与容量提醒可编辑", async ({
  page,
}) => {
  await nav(page, "团队");
  await page.getByRole("button", { name: "暂停小策接单" }).click();
  await nav(page, "目标拆解");
  await page.getByLabel("一句话目标").fill("30 天上线我的个人作品网站");
  await page.getByRole("button", { name: "开始拆解", exact: true }).click();
  await expect(page.getByLabel("我想实现的目标")).toHaveValue(
    "30 天上线我的个人作品网站",
  );
  await page.getByLabel("项目名称").fill("依赖流程测试");
  await page.getByRole("button", { name: "生成执行计划" }).click();
  const owners = await page
    .locator('select[aria-label$="负责人"]')
    .evaluateAll((xs) => xs.map((x) => (x as HTMLSelectElement).value));
  expect(owners).not.toContain("member-strategy");
  await expect(
    page.getByLabel("任务 2 前置任务", { exact: true }),
  ).toHaveValues(["0"]);
  await page
    .getByLabel("任务 1 负责人", { exact: true })
    .selectOption("member-content");
  await page.getByLabel("任务 1 工时", { exact: true }).fill("80");
  await expect(page.locator(".allocation-warnings")).toContainText("超出");
  await page.getByLabel("任务 1 工时", { exact: true }).fill("2");
  await page.screenshot({
    path: "artifacts/boss-allocation.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "确认计划，开始推进" }).click();
  const data = await saved(page);
  const project = data.projects.find(
    (p: { title: string }) => p.title === "依赖流程测试",
  );
  const tasks = data.tasks.filter(
    (t: { projectId: string }) => t.projectId === project.id,
  );
  expect(tasks).toHaveLength(5);
  expect(tasks[1].dependsOn).toEqual([tasks[0].id]);
});

test("所有任务状态入口都阻止未完成依赖，完成后才能生成并传递前置成果", async ({
  page,
}) => {
  await page.route("**/api/config", (r) => r.fulfill({ json: config }));
  let calls: any[] = [];
  await page.route("**/api/execute", (r) => {
    calls.push(r.request().postDataJSON());
    return r.fulfill({
      json: { content: "# 新交付物\n按验收范围执行", source: "ai" },
    });
  });
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("ark-workspace-v1")!);
    s.tasks.find((t: { id: string }) => t.id === "demo-task-1").status = "todo";
    s.tasks.find((t: { id: string }) => t.id === "demo-task-2").dependsOn = [
      "demo-task-1",
    ];
    localStorage.setItem("ark-workspace-v1", JSON.stringify(s));
  });
  await page.goto("/#tasks");
  await page.reload();
  await page
    .getByRole("combobox", { name: "更新搭建知识库目录与索引状态" })
    .selectOption("done");
  await expect(page.getByRole("alert")).toContainText("请先完成前置任务");
  await page.getByRole("button", { name: "列表视图" }).click();
  await page
    .getByRole("button", { name: "完成搭建知识库目录与索引", exact: true })
    .click();
  expect(
    (await saved(page)).tasks.find(
      (t: { id: string }) => t.id === "demo-task-2",
    ).status,
  ).not.toBe("done");
  await page
    .getByRole("button", { name: "查看搭建知识库目录与索引", exact: true })
    .click();
  await page.getByRole("button", { name: "生成交付物", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("请先完成前置任务");
  expect(calls).toHaveLength(0);
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  const predecessor = (await saved(page)).tasks.find(
    (t: { id: string }) => t.id === "demo-task-1",
  );
  await page
    .getByRole("button", { name: "完成" + predecessor.title, exact: true })
    .click();
  await page
    .getByRole("button", { name: "查看搭建知识库目录与索引", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "生成交付物", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新交付物" })).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].dependencies[0].title).toBe(predecessor.title);
});

test("决策中心退回并带意见重新生成，验收后从队列消失", async ({ page }) => {
  await page.route("**/api/config", (r) => r.fulfill({ json: config }));
  let request: any;
  await page.route("**/api/execute", (r) => {
    request = r.request().postDataJSON();
    return r.fulfill({
      json: { content: "# 修订版选题\n补充发布节奏和受众画像", source: "ai" },
    });
  });
  await page.reload();
  await nav(page, "决策中心");
  await page.getByRole("button", { name: "退回修改", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请写明返工要求");
  await page.getByLabel("审批意见").fill("请补充发布节奏和受众画像");
  await page.getByRole("button", { name: "退回修改", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "当前没有待处理事项" }),
  ).toBeVisible();
  await nav(page, "任务看板");
  await page.getByRole("button", { name: "列表视图" }).click();
  await page
    .getByRole("button", { name: "查看制定第一周内容选题", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "请补充发布节奏和受众画像",
  );
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect(page.getByRole("heading", { name: "修订版选题" })).toBeVisible();
  expect(request.task.reviewNote).toContain("受众画像");
  expect(request.task.result).toContain("示例");
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await nav(page, "决策中心");
  await page.getByRole("button", { name: "验收通过", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "当前没有待处理事项" }),
  ).toBeVisible();
  expect(
    (await saved(page)).tasks.find(
      (t: { title: string }) => t.title === "制定第一周内容选题",
    ).status,
  ).toBe("done");
});

test("各模块移动端可阅读且无页面横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const hash of [
    "dashboard",
    "projects",
    "team",
    "decisions",
    "analytics",
    "tasks",
    "settings",
  ]) {
    await page.goto("/#" + hash);
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `artifacts/boss-${hash}-mobile.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      hash,
    ).toBe(true);
    await expect(page.locator(".sidebar")).toBeHidden();
  }
});
