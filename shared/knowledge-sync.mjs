// Derived notes are explicitly marked; an ID prefix must never imply ownership.
export function taskKnowledgeId(taskId) {
  let a = 2166136261,
    b = 0x9e3779b9;
  for (const char of String(taskId)) {
    const value = char.codePointAt(0);
    a = Math.imul(a ^ value, 16777619);
    b = Math.imul(b ^ value, 2246822519);
  }
  return `kd-${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

// Full originals remain on tasks. Keep derived copies bounded and leave manual
// notes untouched, including legacy/imported notes whose IDs happen to use kd-.
export function syncDeliveredKnowledge(state, now = new Date().toISOString()) {
  if (!state?.tasks || !state?.knowledge) return state;
  const manual = state.knowledge.filter((note) => !note.sourceTaskId);
  const occupied = new Set(manual.map((note) => note.id));
  const mirrors = new Map(
    state.knowledge
      .filter((note) => note.sourceTaskId)
      .map((note) => [note.sourceTaskId, note]),
  );
  const nextMirrors = [];
  const room = Math.max(0, 2000 - manual.length);
  let remainingChars = 1_000_000;
  for (const task of state.tasks) {
    if (nextMirrors.length >= room) break;
    if (task.status !== "done" || !String(task.result || "").trim()) continue;
    const id = taskKnowledgeId(task.id);
    // Even an unlikely hash collision cannot overwrite a note or invalidate IDs.
    if (occupied.has(id)) continue;
    const title = String(task.title || "未命名成果").slice(0, 200);
    const content = String(task.result).slice(0, 100000);
    if (content.length > remainingChars) continue;
    remainingChars -= content.length;
    occupied.add(id);
    const previous = mirrors.get(task.id);
    const same =
      previous &&
      previous.id === id &&
      previous.title === title &&
      previous.content === content &&
      (previous.projectId || "") === (task.projectId || "") &&
      previous.category === "资料";
    nextMirrors.push(
      same
        ? previous
        : {
            id,
            sourceTaskId: task.id,
            title,
            content,
            category: "资料",
            updatedAt: task.resultMeta?.at || task.createdAt || now,
            ...(task.projectId ? { projectId: task.projectId } : {}),
          },
    );
  }
  const knowledge = [...nextMirrors, ...manual];
  const unchanged =
    knowledge.length === state.knowledge.length &&
    knowledge.every((note, index) => note === state.knowledge[index]);
  return unchanged ? state : { ...state, knowledge };
}
