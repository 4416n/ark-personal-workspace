const AUTO_PREFIX = "kd-";

export function taskKnowledgeId(taskId) {
  return `${AUTO_PREFIX}${taskId}`.slice(0, 100);
}

// Mirror finished task results into searchable notes. Reopening a task removes
// only that mirror, never a note the user wrote themselves.
export function syncDeliveredKnowledge(state, now = new Date().toISOString()) {
  if (!state?.tasks || !state?.knowledge) return state;
  const manual = [];
  const mirrors = new Map();
  for (const note of state.knowledge) {
    if (String(note.id).startsWith(AUTO_PREFIX)) mirrors.set(note.id, note);
    else manual.push(note);
  }
  const nextMirrors = [];
  for (const task of state.tasks) {
    if (task.status !== "done" || !String(task.result || "").trim()) continue;
    const id = taskKnowledgeId(task.id);
    const title = String(task.title || "未命名成果").slice(0, 200);
    const content = String(task.result).slice(0, 100000);
    const previous = mirrors.get(id);
    const same =
      previous &&
      previous.title === title &&
      previous.content === content &&
      (previous.projectId || "") === (task.projectId || "") &&
      previous.category === "资料";
    nextMirrors.push(
      same
        ? previous
        : {
            id,
            title,
            content,
            category: "资料",
            updatedAt: now,
            ...(task.projectId ? { projectId: task.projectId } : {}),
          },
    );
  }
  const room = Math.max(0, 2000 - manual.length);
  const knowledge = [...nextMirrors.slice(0, room), ...manual];
  const unchanged =
    knowledge.length === state.knowledge.length &&
    knowledge.every((note, index) => note === state.knowledge[index]);
  return unchanged ? state : { ...state, knowledge };
}
