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
  assert.equal(
    syncDeliveredKnowledge(once, "2026-11-10T01:00:00.000Z"),
    once,
  );
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
  assert.ok(synced.knowledge.some((note) => note.content === "可检索的分类说明"));
});
