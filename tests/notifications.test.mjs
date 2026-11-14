import { test } from "node:test";
import assert from "node:assert/strict";
import { workspaceNotices } from "../shared/notifications.mjs";
import { seedWorkspace } from "../src/domain.ts";

test("reminders reflect actionable work without exposing result bodies or changing task state", () => {
  const state = seedWorkspace();
  state.projects.forEach((project) => project.status = "active");
  const original = structuredClone(state.tasks[5]);
  state.tasks = [
    { ...original, id: "review", status: "review", deadline: "2026-01-01", result: "private result body" },
    { ...original, id: "overdue", status: "doing", deadline: "2026-01-01" },
    { ...original, id: "unassigned", status: "todo", ownerId: "", deadline: "2026-12-31" },
    { ...original, id: "today", status: "doing", deadline: "2026-11-14" },
    { ...original, id: "done", status: "done", deadline: "2026-01-01" },
  ];
  const before = structuredClone(state);
  const notices = workspaceNotices(state, [], "2026-11-14");
  assert.deepEqual(notices.map((notice) => notice.kind), ["review", "overdue", "unassigned", "today"]);
  assert.equal(notices.length, 4);
  assert.ok(!JSON.stringify(notices).includes("private result body"));
  assert.deepEqual(state, before);
  const reviewId = notices[0].id;
  state.tasks[0].result += " revised";
  assert.notEqual(workspaceNotices(state, [], "2026-11-14")[0].id, reviewId);
  state.projects.forEach((project) => project.status = "paused");
  assert.equal(workspaceNotices(state, [], "2026-11-14").length, 0);
});

test("completed and failed AI work is separate from running/cancelled calls and model tests", () => {
  const state = seedWorkspace();
  state.tasks = [];
  const run = { kind: "execute", label: "交付方案", startedAt: "2026-11-14T00:00:00.000Z" };
  const runs = [
    { ...run, id: "done", status: "succeeded" },
    { ...run, id: "failure", status: "failed" },
    { ...run, id: "cancelled", status: "cancelled" },
    { ...run, id: "running", status: "running" },
    { ...run, id: "test", kind: "test", status: "failed" },
  ];
  const notices = workspaceNotices(state, runs, "2026-11-14");
  assert.deepEqual(notices.map((notice) => notice.kind), ["failed", "completed"]);
  assert.equal(notices[0].runId, "failure");
});
