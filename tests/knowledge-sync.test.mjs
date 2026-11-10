import { test } from "node:test";
import assert from "node:assert/strict";
import { syncDeliveredKnowledge } from "../shared/knowledge-sync.mjs";
import { stateSchema, seedWorkspace } from "../src/domain.ts";

test("完成成果写入知识库，重开后只移除镜像", () => {
  const state = {
    tasks: [
      {
        id: "task-1",
        projectId: "p1",
        title: "需求规范",
        status: "done",
        result: "# 规范\n\n第一条",
      },
      {
        id: "task-2",
        projectId: "p1",
        title: "空成果",
        status: "done",
        result: "  ",
      },
    ],
    knowledge: [
      {
        id: "welcome",
        title: "欢迎",
        content: "保留",
        category: "资料",
        updatedAt: "2026-11-01T00:00:00.000Z",
      },
    ],
  };
  const once = syncDeliveredKnowledge(state, "2026-11-10T00:00:00.000Z");
  assert.equal(syncDeliveredKnowledge(once, "2026-11-10T01:00:00.000Z"), once);
  assert.equal(once.knowledge[0].content, "# 规范\n\n第一条");
  assert.equal(once.knowledge[0].projectId, "p1");
  assert.equal(once.knowledge[1].id, "welcome");
  const reopened = syncDeliveredKnowledge(
    {
      ...once,
      tasks: [{ ...once.tasks[0], status: "doing" }, once.tasks[1]],
    },
    "2026-11-10T02:00:00.000Z",
  );
  assert.deepEqual(
    reopened.knowledge.map((note) => note.id),
    ["welcome"],
  );
});

test("示例工作台同步后仍能通过状态校验", () => {
  const state = seedWorkspace();
  state.tasks[0] = {
    ...state.tasks[0],
    status: "done",
    result: "可检索的分类说明",
  };
  const synced = syncDeliveredKnowledge(state, "2026-11-10T00:00:00.000Z");
  assert.equal(stateSchema.safeParse(synced).success, true);
  assert.ok(
    synced.knowledge.some((note) => note.content === "可检索的分类说明"),
  );
});

test("手写 kd- 笔记不被删除；长任务 ID 不截断碰撞；镜像明确标记来源", async () => {
  const { taskKnowledgeId } = await import("../shared/knowledge-sync.mjs");
  const prefix = "x".repeat(99);
  const tasks = ["a", "b"].map((suffix) => ({
    id: prefix + suffix,
    title: suffix,
    result: suffix,
    status: "done",
    projectId: "p",
  }));
  const manual = { id: "kd-task-1", title: "手写资料", content: "保留原文" };
  const synced = syncDeliveredKnowledge({ tasks, knowledge: [manual] });
  assert.equal(synced.knowledge.length, 3);
  assert.notEqual(taskKnowledgeId(tasks[0].id), taskKnowledgeId(tasks[1].id));
  assert.deepEqual(
    synced.knowledge.slice(0, 2).map((n) => n.sourceTaskId),
    tasks.map((t) => t.id),
  );
  const reopened = syncDeliveredKnowledge({ ...synced, tasks: [] });
  assert.deepEqual(reopened.knowledge, [manual]);
  const collision = { ...manual, id: taskKnowledgeId(tasks[0].id) };
  const withCollision = syncDeliveredKnowledge({
    tasks,
    knowledge: [collision],
  });
  assert.equal(withCollision.knowledge.length, 2);
  assert.equal(withCollision.knowledge.at(-1), collision);
});

test("数据库保存统一生成镜像，读取不改版本，重开清理镜像不动人工资料", async (t) => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { openDatabase } = await import("../server/database.mjs");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-knowledge-"));
  const db = openDatabase(dir);
  t.after(async () => {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const state = seedWorkspace();
  const manual = {
    id: "kd-manual",
    title: "人工资料",
    content: "不可删除",
    category: "资料",
    updatedAt: new Date().toISOString(),
  };
  state.knowledge = [manual];
  state.tasks = [{ ...state.tasks[0], status: "done", result: "已完成的正文" }];
  let saved = db.save(state, 0);
  assert.equal(saved.state.knowledge.length, 2);
  assert.equal(saved.state.knowledge[0].sourceTaskId, state.tasks[0].id);
  assert.deepEqual(db.read(), db.read());
  assert.equal(db.read().revision, 1);
  saved.state.tasks[0].status = "todo";
  saved = db.save(saved.state, saved.revision);
  assert.deepEqual(saved.state.knowledge, [manual]);
});

test("衍生知识有总量上限，完整任务成果保留；审查不引用自己的镜像", async () => {
  const { reviewMessages } = await import("../server/work-output.mjs");
  const state = seedWorkspace();
  state.tasks = Array.from({ length: 20 }, (_, i) => ({
    ...state.tasks[0],
    id: `task-${i}`,
    status: "done",
    result: "文".repeat(100000),
  }));
  state.knowledge = [];
  const synced = syncDeliveredKnowledge(state);
  assert.ok(
    synced.knowledge.reduce((sum, n) => sum + n.content.length, 0) <= 1_000_000,
  );
  assert.equal(synced.tasks, state.tasks);
  const task = { ...state.tasks[0], title: "苹果规范", result: "正文" };
  const { sources } = reviewMessages({
    task,
    project: state.projects[0],
    knowledge: [
      {
        id: "self",
        sourceTaskId: task.id,
        title: task.title,
        content: "苹果规范",
      },
      { id: "manual", title: "苹果规范", content: "独立资料" },
    ],
  });
  assert.deepEqual(
    sources.map((n) => n.noteId),
    ["manual"],
  );
});
