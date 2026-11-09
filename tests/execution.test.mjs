import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionableTasks,
  taskLayers,
  taskReadiness,
  downstreamIds,
} from "../shared/execution.mjs";
import { seedWorkspace } from "../src/domain.ts";
const project = { id: "p", status: "active" };
const member = { id: "m", name: "成员", availability: "available" };
const base = {
  id: "a",
  title: "确认需求",
  projectId: "p",
  ownerId: "m",
  status: "todo",
  dependsOn: [],
  deadline: "2026-11-10",
  priority: "high",
};
const parent = { ...base, status: "done" };
const next = { ...base, id: "b", title: "制作方案", dependsOn: ["a"] };
test("真实任务状态区分可推进、前置阻塞、成员暂停、项目暂停与验收", () => {
  const signal = (
    task,
    tasks = [parent, next],
    members = [member],
    projects = [project],
  ) => taskReadiness(task, tasks, members, projects);
  assert.equal(signal(next).kind, "ready");
  assert.equal(signal(next, [base, next]).kind, "blocked");
  assert.equal(
    signal(next, [parent, next], [{ ...member, availability: "paused" }]).kind,
    "member-paused",
  );
  assert.equal(
    signal(next, [parent, next], [member], [{ ...project, status: "paused" }])
      .kind,
    "project-paused",
  );
  assert.equal(signal({ ...next, ownerId: "" }).kind, "unassigned");
  assert.equal(
    signal({ ...next, status: "review", ownerId: "", result: "成果" }).kind,
    "review",
  );
  assert.equal(
    signal({ ...next, status: "review" }, [base, next]).kind,
    "blocked",
  );
  assert.equal(
    signal({ ...next, status: "doing", reviewNote: "补充来源" }).reason,
    "待修改：补充来源",
  );
  assert.equal(signal({ ...next, status: "done" }).kind, "done");
});
test("行动队列优先验收、按逾期排序，排除已结束或暂停项目，聚焦不泄漏其他项目", () => {
  const tasks = [
    { ...base, id: "first", status: "doing" },
    { ...base, id: "review", status: "review", deadline: "2026-11-30" },
    { ...base, id: "overdue", deadline: "2026-11-01" },
    { ...base, id: "paused", projectId: "paused" },
    { ...base, id: "closed", projectId: "closed" },
    { ...base, id: "done", status: "done" },
  ];
  const workspace = {
    tasks,
    members: [member],
    projects: [
      project,
      { id: "paused", status: "paused" },
      { id: "closed", status: "done" },
    ],
  };
  const queue = actionableTasks(workspace, "2026-11-09");
  assert.deepEqual(
    queue.map((x) => x.task.id),
    ["review", "overdue", "first"],
  );
  assert.equal(queue[1].overdue, true);
  assert.deepEqual(actionableTasks(workspace, "2026-11-09", "paused"), []);
  const s = seedWorkspace();
  const q = actionableTasks(s, "2026-11-09", "demo-knowledge");
  assert.ok(
    q.every(
      (x) => x.task.projectId === "demo-knowledge" && x.task.status !== "done",
    ),
  );
});
test("协作路线按最长前置链分层，同层并行，拒绝循环", () => {
  const c = { ...base, id: "c", dependsOn: ["a"] };
  const d = { ...base, id: "d", dependsOn: ["b", "c"] };
  assert.deepEqual(
    taskLayers([d, c, next, base]).map((group) => group.map((t) => t.id)),
    [["a"], ["c", "b"], ["d"]],
  );
  assert.deepEqual(taskLayers([{ ...base, dependsOn: ["b"] }, next]), []);
  assert.deepEqual(downstreamIds("a", [d, c, next, base]).sort(), [
    "b",
    "c",
    "d",
  ]);
  assert.deepEqual(downstreamIds("d", [d, c, next, base]), []);
});
