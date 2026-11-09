import { test } from "node:test";
import assert from "node:assert/strict";
import { localPlan, matchMember, parsePlan } from "../server/planner.mjs";
const members = [
  {
    id: "writer",
    name: "Writer",
    role: "内容创作师",
    skills: ["文案", "写作", "内容策划"],
    capacity: 40,
  },
  {
    id: "dev",
    name: "Developer",
    role: "工程师",
    skills: ["技术", "开发", "自动化", "知识库"],
    capacity: 40,
  },
  {
    id: "pm",
    name: "PM",
    role: "策略师",
    skills: ["目标拆解", "需求分析", "项目管理", "调研", "复盘"],
    capacity: 40,
  },
];
test("匹配依据技能且考虑负载", () => {
  assert.equal(matchMember(["开发", "技术"], members).ownerId, "dev");
  const alternatives = [
    { ...members[0], id: "a", capacity: 10 },
    { ...members[0], id: "b", capacity: 10 },
  ];
  assert.equal(
    matchMember(["写作"], alternatives, [
      { ownerId: "a", status: "doing", estimatedHours: 20 },
    ]).ownerId,
    "b",
  );
  assert.equal(matchMember(["写作"], []).ownerId, "");
});
test("不同目标使用不同任务流程，并且能在无员工情况下规划", () => {
  const content = localPlan("每周发布两篇原创文章", members);
  const tech = localPlan("开发一个自动化工具网站", members);
  assert.equal(content.length, 5);
  assert.equal(content[1].ownerId, "writer");
  assert.equal(tech[2].ownerId, "dev");
  assert.notDeepEqual(
    content.map((t) => t.title),
    tech.map((t) => t.title),
  );
  assert.ok(localPlan("学习英语", []).every((t) => t.ownerId === ""));
});
test("模型输出校验、归一化和重新匹配，拒绝无效结构", () => {
  const parsed = parsePlan(
    '```json\n{"tasks":[{"title":" 实现登录 ","description":"提供代码与测试步骤","ownerId":"fake","skills":["开发",42],"priority":"invalid","estimatedHours":999}]}\n```',
    members,
    [],
  );
  assert.equal(parsed[0].ownerId, "dev");
  assert.equal(parsed[0].priority, "medium");
  assert.equal(parsed[0].estimatedHours, 80);
  assert.equal(parsed[0].title, "实现登录");
  assert.throws(() => parsePlan('{"tasks":[]}', members, []));
  assert.throws(() => parsePlan('{"tasks":[{"title":123}]}', members, []));
});
