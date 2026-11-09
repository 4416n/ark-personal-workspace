// Shared invariants for imports and every task-state entry point.
export function dependencyError(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const degree = new Map();
  const successors = new Map();
  for (const task of tasks) {
    const deps = task.dependsOn || [];
    if (new Set(deps).size !== deps.length) return "前置任务不能重复";
    degree.set(task.id, deps.length);
    for (const id of deps) {
      const parent = byId.get(id);
      if (!parent) return "前置任务不存在";
      if (id === task.id) return "任务不能依赖自身";
      if (parent.projectId !== task.projectId)
        return "前置任务必须属于同一项目";
      if (!successors.has(id)) successors.set(id, []);
      successors.get(id).push(task.id);
    }
  }
  const ready = tasks.filter((t) => !degree.get(t.id)).map((t) => t.id);
  for (let i = 0; i < ready.length; i++) {
    for (const id of successors.get(ready[i]) || []) {
      degree.set(id, degree.get(id) - 1);
      if (!degree.get(id)) ready.push(id);
    }
  }
  return ready.length === tasks.length ? "" : "前置任务存在循环依赖";
}

export function transitionError(task, status, tasks) {
  if (status !== "todo") {
    const pending = tasks.filter(
      (t) => task.dependsOn?.includes(t.id) && t.status !== "done",
    );
    if (pending.length)
      return `请先完成前置任务：${pending.map((t) => t.title).join("、")}`;
  }
  if (task.status === "done" && status !== "done") {
    const active = tasks.filter(
      (t) => t.dependsOn?.includes(task.id) && t.status !== "todo",
    );
    if (active.length)
      return `后续任务已启动，请先将后续任务退回待开始：${active.map((t) => t.title).join("、")}`;
  }
  return "";
}
