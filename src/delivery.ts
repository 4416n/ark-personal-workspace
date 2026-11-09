import type { Task, ResultVersion, Workspace } from "./domain.ts";
import { uuid } from "../shared/id.mjs";

export const HISTORY_LIMIT = 12;
const TASK_HISTORY_CHARS = 160000;
const WORKSPACE_HISTORY_CHARS = 600000;
const WORKSPACE_REVIEW_CHARS = 120000;

const stamp = () => new Date().toISOString();
const id = uuid;
export const versionReason = {
  baseline: "首次留存",
  manual: "手动编辑",
  ai: "AI 生成",
  restore: "版本恢复",
};

// Old workspaces gain metadata only when the result is edited or reviewed.
// A baseline timestamp is the time of preservation, not an invented creation date.
export function ensureResultMeta(task: Task): Task {
  return task.resultMeta || !task.result
    ? task
    : {
        ...task,
        resultMeta: { id: id(), number: 1, at: stamp(), reason: "baseline" },
      };
}

function trimTaskHistory(versions: ResultVersion[]) {
  let chars = 0;
  return versions.slice(0, HISTORY_LIMIT).filter((v) => {
    chars += v.content.length;
    return chars <= TASK_HISTORY_CHARS;
  });
}

export function replaceResult(
  task: Task,
  content: string,
  reason: "manual" | "ai" | "restore",
  source: Task["source"],
  restoredFrom?: number,
): Task {
  if (reason === "manual" && task.result === content) return task;
  const previous = ensureResultMeta(task);
  const history = [...(previous.resultHistory || [])];
  if (previous.resultMeta && previous.result) {
    history.unshift({
      ...previous.resultMeta,
      content: previous.result,
      source: previous.source,
      ...(previous.resultSources ? { sources: previous.resultSources } : {}),
    });
  }
  const { resultSources: _sources, ...previousWithoutSources } = previous;
  return {
    ...previousWithoutSources,
    result: content,
    ...(reason === "manual" && previous.resultSources
      ? { resultSources: previous.resultSources }
      : {}),
    source,
    status:
      reason !== "manual" || previous.status === "done"
        ? "review"
        : previous.status,
    resultMeta: {
      id: id(),
      number: (previous.resultMeta?.number || 0) + 1,
      at: stamp(),
      reason,
      ...(restoredFrom ? { restoredFrom } : {}),
    },
    resultHistory: trimTaskHistory(history),
  };
}

// Keep form edits, but compare result text with the last staged/saved content.
export function prepareTaskDraft(base: Task, draft: Task): Task {
  return replaceResult(
    {
      ...draft,
      result: base.result,
      source: base.source,
      resultMeta: base.resultMeta,
      resultHistory: base.resultHistory,
      reviews: base.reviews,
      reviewNote: base.reviewNote,
    },
    draft.result,
    "manual",
    "manual",
  );
}

export function restoreResult(task: Task, version: ResultVersion): Task {
  return {
    ...replaceResult(
      task,
      version.content,
      "restore",
      version.source,
      version.number,
    ),
    ...(version.sources ? { resultSources: version.sources } : {}),
  };
}

export function recordReview(
  task: Task,
  action: "approved" | "returned",
  note: string,
): Task {
  if (action === "returned" && !note.trim()) throw new Error("请填写返工要求");
  if (action === "approved" && !task.result.trim())
    throw new Error("请先补充交付物");
  const next = ensureResultMeta(task);
  const reviewNote = note.trim() || "验收通过";
  return {
    ...next,
    status: action === "approved" ? "done" : "doing",
    reviewNote,
    legacyReviewNote:
      next.legacyReviewNote ||
      (!next.reviews?.length ? next.reviewNote : undefined),
    reviews: [
      {
        id: id(),
        at: stamp(),
        action,
        note: reviewNote,
        ...(next.resultMeta
          ? {
              versionId: next.resultMeta.id,
              versionNumber: next.resultMeta.number,
            }
          : {}),
      },
      ...(next.reviews || []),
    ].slice(0, 50),
  };
}

// Bound only historical content. Never remove the current result or imported data.
// Called after ordinary task updates, not backup restoration.
export function boundWorkspaceHistory(
  tasks: Workspace["tasks"],
): Workspace["tasks"] {
  const versions = tasks
    .flatMap((t) =>
      (t.resultHistory || []).map((v) => ({ ...v, taskId: t.id })),
    )
    .sort((a, b) => b.at.localeCompare(a.at) || b.number - a.number);
  const keepVersions = new Set<string>();
  let chars = 0;
  for (const v of versions) {
    if (chars + v.content.length > WORKSPACE_HISTORY_CHARS) break;
    chars += v.content.length;
    keepVersions.add(`${v.taskId}/${v.id}`);
  }
  const reviews = tasks
    .flatMap((t) => (t.reviews || []).map((r) => ({ ...r, taskId: t.id })))
    .sort((a, b) => b.at.localeCompare(a.at));
  const keepReviews = new Set<string>();
  chars = 0;
  for (const r of reviews.slice(0, 2000)) {
    if (chars + r.note.length > WORKSPACE_REVIEW_CHARS) break;
    chars += r.note.length;
    keepReviews.add(`${r.taskId}/${r.id}`);
  }
  return tasks.map((t) => {
    const resultHistory = t.resultHistory?.filter((v) =>
      keepVersions.has(`${t.id}/${v.id}`),
    );
    const reviews = t.reviews?.filter((r) =>
      keepReviews.has(`${t.id}/${r.id}`),
    );
    return resultHistory?.length === t.resultHistory?.length &&
      reviews?.length === t.reviews?.length
      ? t
      : { ...t, resultHistory, reviews };
  });
}
