import { test } from "node:test";
import assert from "node:assert/strict";
import { seedWorkspace, stateSchema } from "../src/domain.ts";
import {
  prepareTaskDraft,
  replaceResult,
  restoreResult,
  recordReview,
  boundWorkspaceHistory,
} from "../src/delivery.ts";
import {
  emptyRetro,
  projectFacts,
  retrospectiveMarkdown,
} from "../src/retrospective.ts";

const task = () => ({
  ...seedWorkspace().tasks[0],
  result: "旧成果",
  source: "ai",
  status: "done",
});

test("旧版工作台无损兼容；普通字段编辑不会制造成果版本", () => {
  const s = seedWorkspace();
  assert.deepEqual(stateSchema.parse(JSON.parse(JSON.stringify(s))), s);
  const old = task();
  const next = prepareTaskDraft(old, { ...old, title: "修改标题" });
  assert.equal(next.resultMeta, undefined);
  assert.equal(next.source, "ai");
  assert.equal(next.status, "done");
});

test("人工修改已通过成果保留原文与来源，新成果需要重验；清空仍能恢复", () => {
  const old = task();
  const edited = prepareTaskDraft(old, { ...old, result: "人工修订" });
  assert.equal(edited.resultHistory[0].content, "旧成果");
  assert.equal(edited.resultHistory[0].source, "ai");
  assert.equal(edited.resultHistory[0].reason, "baseline");
  assert.equal(edited.resultMeta.number, 2);
  assert.equal(edited.source, "manual");
  assert.equal(edited.status, "review");
  const empty = prepareTaskDraft(edited, { ...edited, result: "" });
  assert.equal(empty.resultHistory[0].content, "人工修订");
  assert.equal(restoreResult(empty, empty.resultHistory[0]).result, "人工修订");
});

test("重新生成及恢复前先留存未保存的人工稿，恢复不继承旧审批状态", () => {
  const old = task();
  const draft = prepareTaskDraft(old, { ...old, result: "尚未保存的修改" });
  const generated = replaceResult(draft, "新模型成果", "ai", "ai");
  assert.deepEqual(
    generated.resultHistory.map((v) => v.content),
    ["尚未保存的修改", "旧成果"],
  );
  const restored = restoreResult(generated, generated.resultHistory[1]);
  assert.equal(restored.result, "旧成果");
  assert.equal(restored.resultMeta.restoredFrom, 1);
  assert.equal(restored.resultMeta.number, 4);
  assert.equal(restored.resultHistory[0].content, "新模型成果");
  assert.equal(restored.status, "review");
  const unchanged = prepareTaskDraft(restored, restored);
  assert.deepEqual(unchanged, restored);
});

test("多轮返工与通过关联准确版本，旧版无时间的意见也保留", () => {
  const old = { ...task(), reviewNote: "旧要求：引用数据" };
  const returned = recordReview(old, "returned", "请补充来源");
  const generated = replaceResult(returned, "带来源的新成果", "ai", "ai");
  const approved = recordReview(generated, "approved", "符合标准");
  assert.equal(approved.legacyReviewNote, "旧要求：引用数据");
  assert.deepEqual(
    approved.reviews.map((r) => [r.action, r.versionNumber]),
    [
      ["approved", 2],
      ["returned", 1],
    ],
  );
  assert.equal(approved.reviews[1].versionId, approved.resultHistory[0].id);
  assert.equal(approved.reviewNote, "符合标准");
  assert.throws(() => recordReview(old, "returned", "  "));
  assert.throws(() => recordReview({ ...old, result: "  " }, "approved", ""));
  const s = seedWorkspace();
  s.tasks[0] = approved;
  assert.deepEqual(stateSchema.parse(JSON.parse(JSON.stringify(s))), s);
});

test("留存上限清理最早历史，当前成果和最新审批意见始终保留", () => {
  let t = task();
  for (let i = 0; i < 60; i++) {
    t = recordReview(
      replaceResult(t, `稿件${i}`, "ai", "ai"),
      "returned",
      `返工${i}`,
    );
  }
  assert.equal(t.resultHistory.length, 12);
  assert.equal(t.reviews.length, 50);
  let large = task();
  for (let i = 0; i < 8; i++)
    large = replaceResult(large, "大".repeat(90000), "ai", "ai");
  assert.ok(
    large.resultHistory.reduce((n, v) => n + v.content.length, 0) <= 160000,
  );
  const tasks = Array.from({ length: 12 }, (_, i) => ({
    ...large,
    id: `t${i}`,
  }));
  const bounded = boundWorkspaceHistory(tasks);
  assert.ok(
    bounded
      .flatMap((t) => t.resultHistory)
      .reduce((n, v) => n + v.content.length, 0) <= 600000,
  );
  assert.ok(bounded.every((t) => t.result === large.result));
  assert.equal(boundWorkspaceHistory([t])[0].reviewNote, "返工59");
});

test("项目复盘反映真实记录，不把批量完成当验收，区分计划与实际", () => {
  const s = seedWorkspace();
  const p = s.projects[0];
  const tasks = s.tasks
    .filter((t) => t.projectId === p.id)
    .map((t) => ({ ...t, status: "done" }));
  assert.equal(projectFacts(tasks).approved, 0);
  const report = retrospectiveMarkdown(
    p,
    tasks,
    s.members,
    { ...emptyRetro, lessons: "先明确验收标准" },
    "2026-11-09T12:00:00.000Z",
  );
  assert.ok(report.includes("非实际耗时"));
  assert.ok(report.includes("审批统计仅包含留存记录"));
  assert.ok(report.includes("先明确验收标准"));
  assert.ok(report.includes("示例项目，非真实经营数据"));
  assert.ok(
    retrospectiveMarkdown(p, [], s.members, emptyRetro).includes(
      "尚未建立执行任务",
    ),
  );
});
