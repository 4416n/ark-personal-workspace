import { test } from "node:test";
import assert from "node:assert/strict";
import { stateSchema, seedWorkspace } from "../src/domain.ts";
import { dependencyError, transitionError } from "../shared/task-policy.mjs";
import { rankMembers, recommendedMember } from "../shared/matching.mjs";
import { localPlan, parsePlan } from "../server/planner.mjs";

const member = {
  id: "a",
  name: "A",
  skills: ["开发"],
  skillLevels: { 开发: 5 },
  capacity: 20,
};
test("能力等级参与推荐，暂停员工排除，分配后负载可解释", () => {
  const second = { ...member, id: "b", skillLevels: { 开发: 2 } };
  assert.equal(recommendedMember(["开发"], [second, member]).ownerId, "a");
  assert.equal(
    recommendedMember(["开发"], [second, { ...member, availability: "paused" }])
      .ownerId,
    "b",
  );
  assert.equal(
    recommendedMember(["开发"], [{ ...member, availability: "paused" }])
      .ownerId,
    "",
  );
  const rank = rankMembers(
    ["开发"],
    [member],
    [{ ownerId: "a", status: "todo", estimatedHours: 18 }],
    5,
  )[0];
  assert.equal(rank.afterLoad, 1.15);
  assert.ok(rank.reason.includes("超出计划容量"));
  assert.equal(rank.score, 75);
  const plan = localPlan("开发个人网站", [member]);
  assert.deepEqual(
    plan.map((t) => t.dependsOn),
    [[], [0], [1], [2], [3]],
  );
});
test("模型依赖归一化仅允许已出现的任务，排除未来、自身与重复引用", () => {
  const tasks = [0, 1, 2].map((i) => ({
    title: `任务${i}`,
    description: "交付要求",
    skills: ["开发"],
    dependsOn: [-1, 0, 0, 1, 2, 7, "0"],
  }));
  assert.deepEqual(
    parsePlan(JSON.stringify(tasks), [member], []).map((t) => t.dependsOn),
    [[], [0], [0, 1]],
  );
});
const a = {
  id: "a",
  projectId: "p",
  title: "A",
  status: "todo",
  dependsOn: [],
};
const b = { ...a, id: "b", title: "B", dependsOn: ["a"] };
test("依赖校验拒绝自环、缺失、跨项目与循环，状态转换不绕过依赖", () => {
  assert.equal(dependencyError([a, b]), "");
  assert.match(
    dependencyError([a, { ...b, dependsOn: ["missing"] }]),
    /不存在/,
  );
  assert.match(dependencyError([a, { ...b, dependsOn: ["b"] }]), /自身/);
  assert.match(dependencyError([a, { ...b, projectId: "other" }]), /同一项目/);
  assert.match(dependencyError([{ ...a, dependsOn: ["b"] }, b]), /循环/);
  assert.match(transitionError(b, "doing", [a, b]), /前置任务/);
  assert.match(transitionError(b, "done", [a, b]), /前置任务/);
  assert.equal(transitionError(b, "doing", [{ ...a, status: "done" }, b]), "");
  assert.match(
    transitionError({ ...a, status: "done" }, "todo", [
      { ...a, status: "done" },
      { ...b, status: "review" },
    ]),
    /后续任务/,
  );
});
test("原版数据兼容；新增部门、负责人和依赖均经过导入校验", () => {
  const original = seedWorkspace();
  delete original.departments;
  const migrated = stateSchema.parse(original);
  assert.deepEqual(migrated.departments, []);
  assert.equal(migrated.tasks.length, 11);
  const broken = structuredClone(migrated);
  broken.tasks[0].dependsOn = ["unknown"];
  assert.equal(stateSchema.safeParse(broken).success, false);
  const badLead = structuredClone(migrated);
  badLead.departments = [
    { name: "研发部", mission: "开发", leadId: "member-content", budget: 0 },
  ];
  assert.equal(stateSchema.safeParse(badLead).success, false);
  const memberBad = structuredClone(migrated);
  memberBad.members[0].traits = ["过长".repeat(20)];
  assert.equal(stateSchema.safeParse(memberBad).success, false);
});
