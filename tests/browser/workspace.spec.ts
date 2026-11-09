import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "拆解新目标" })).toBeVisible();
});

test("创建项目、调整分工、更新任务并刷新保留", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "拆解新目标" }).click();
  await page.getByLabel("项目名称").fill("我的真实产品发布计划");
  await page
    .getByLabel("我想实现的目标")
    .fill("两周内开发一个展示个人作品的网站，形成可以发布的首版。");
  await page.getByRole("button", { name: "生成执行计划" }).click();
  await expect(
    page.getByRole("dialog", { name: "让合适的伙伴，各展所长" }),
  ).toBeVisible();
  await page
    .getByLabel("任务 1 标题", { exact: true })
    .fill("明确作品网站定位");
  await page
    .getByLabel("任务 1 负责人", { exact: true })
    .selectOption("member-content");
  await page.getByRole("button", { name: "确认计划，开始推进" }).click();
  await page
    .getByRole("button", { name: /我的真实产品发布计划.*项目进度/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText("明确作品网站定位");
  await page
    .getByRole("button", { name: "查看明确作品网站定位", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "负责人", exact: true }),
  ).toHaveValue("member-content");
  await page.getByLabel("任务状态").selectOption("doing");
  await page.getByRole("button", { name: "手动编辑" }).click();
  await page
    .getByLabel("任务交付物", { exact: true })
    .fill("# 定位方案\n面向潜在客户展示代表作品。");
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "目标拆解", exact: true }).click();
  await page
    .getByRole("button", { name: /我的真实产品发布计划.*项目进度/ })
    .click();
  await page
    .getByRole("button", { name: "查看明确作品网站定位", exact: true })
    .click();
  await expect(page.getByLabel("任务状态")).toHaveValue("doing");
  await expect(page.getByRole("heading", { name: "定位方案" })).toBeVisible();
  await page.getByRole("button", { name: "验收通过" }).click();
  expect(errors).toEqual([]);
});

test("员工和知识新增、搜索及安全导入导出", async ({ page }) => {
  await page.getByRole("button", { name: "团队", exact: true }).click();
  await page.getByRole("button", { name: "添加员工", exact: true }).click();
  await page.getByLabel("姓名", { exact: true }).fill("小研");
  await page.getByLabel("角色", { exact: true }).fill("行业研究员");
  await page.getByLabel("技能标签").fill("市场研究，数据分析，调研");
  await page.getByRole("button", { name: "保存员工" }).click();
  await expect(
    page.locator(".org-person").getByText("小研", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "知识空间", exact: true }).click();
  await page.getByRole("button", { name: "新建笔记" }).click();
  await page.getByLabel("笔记标题").fill("我的内容风格指南");
  await page.getByLabel("笔记内容").fill("# 风格\n语言简洁，使用具体案例。");
  await page.getByRole("button", { name: "保存笔记" }).click();
  await page.getByRole("button", { name: "搜索任何内容..." }).click();
  await page.getByLabel("全局搜索").fill("内容风格");
  await expect(
    page.getByRole("button", { name: "知识 我的内容风格指南" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page.getByRole("button", { name: "工作台设置", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部数据" }).click();
  const download = await downloaded;
  const backupPath = await download.path();
  expect(download.suggestedFilename()).toContain("方舟工作台备份");
  const input = page.locator("input[type=file]");
  await input.setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":1}'),
  });
  await expect(page.getByRole("alert")).toContainText("备份格式不正确");
  await input.setInputFiles(backupPath!);
  await expect(
    page.getByRole("dialog", { name: "确认恢复这份备份" }),
  ).toContainText("5 位员工");
  await page.getByRole("button", { name: "确认替换并恢复" }).click();
  await expect(page.getByRole("status")).toContainText("备份已恢复");
});

test("本地简报、状态列表和示例清理", async ({ page }) => {
  await page.getByRole("button", { name: "决策助手 AI" }).click();
  await page.getByRole("button", { name: "本地简报", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "你的工作台简报" }),
  ).toBeVisible();
  await expect(page.getByText("非 AI 生成", { exact: false })).toBeVisible();
  await page
    .getByRole("button", { name: /任务看板/ })
    .first()
    .click();
  await page.getByRole("button", { name: "列表视图" }).click();
  await expect(page.locator(".task-row")).toHaveCount(11);
  await page.getByRole("button", { name: "工作台设置", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "清除示例", exact: true }).click();
  await page.getByRole("button", { name: "目标拆解", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "给公司一个明确的方向" }),
  ).toBeVisible();
});

test("桌面和移动布局不溢出", async ({ page }) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "artifacts/dashboard-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/dashboard-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page
    .getByRole("button", { name: /任务看板/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "任务看板", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page.getByRole("button", { name: "工作台设置", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("AI 成果保存为待验收，刷新后保留且可人工通过", async ({ page }) => {
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        configured: true,
        provider: "test",
        model: "test-model",
        baseUrl: "https://example.com/v1",
      },
    }),
  );
  let calls = 0;
  await page.route("**/api/execute", (route) => {
    calls++;
    return route.fulfill({
      json: {
        content: "# 知识库目录方案\n\n1. 项目资料\n2. 长期知识\n3. 每周复盘",
        source: "ai",
      },
    });
  });
  await page.reload();
  await page
    .getByRole("button", { name: /任务看板/ })
    .first()
    .click();
  await page.getByRole("button", { name: "列表视图" }).click();
  await page
    .getByRole("button", { name: "查看搭建知识库目录与索引", exact: true })
    .click();
  await page.getByLabel("预估工时（小时）").fill("");
  await page.getByRole("button", { name: "生成交付物", exact: true }).click();
  await expect(
    page.getByText("请先补全有效的任务标题、项目、日期和工时"),
  ).toBeVisible();
  expect(calls).toBe(0);
  await page.getByLabel("预估工时（小时）").fill("4");
  await page.getByRole("button", { name: "生成交付物", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "知识库目录方案" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "任务状态" })).toHaveValue(
    "review",
  );
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: /任务看板/ })
    .first()
    .click();
  await page.getByRole("button", { name: "列表视图" }).click();
  await page
    .getByRole("button", { name: "查看搭建知识库目录与索引", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "知识库目录方案" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "验收通过" }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ark-workspace-v1")!),
  );
  expect(
    saved.tasks.find((t: { id: string }) => t.id === "demo-task-2").status,
  ).toBe("done");
});

test("损坏的历史数据保留原文并提供恢复出口", async ({ page }) => {
  const raw = '{"version":1,"broken":"需要保留的原始内容"}';
  await page.evaluate(
    (value) => localStorage.setItem("ark-workspace-v1", value),
    raw,
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "导出原始数据" }),
  ).toBeVisible();
  const stored = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("ark-workspace-v1-recovery-"))
      .map((k) => localStorage.getItem(k)),
  );
  expect(stored).toContain(raw);
  const next = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ark-workspace-v1")!),
  );
  expect(next.projects).toEqual([]);
});
