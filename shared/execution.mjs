// Readiness describes recorded work, never actual background AI activity.
export function taskReadiness(task, tasks, members, projects) {
  const project = projects.find((p) => p.id === task.projectId);
  const owner = members.find((m) => m.id === task.ownerId);
  const pending = tasks.filter(
    (t) => task.dependsOn?.includes(t.id) && t.status !== "done",
  );
  if (task.status === "done")
    return {
      kind: "done",
      label: "已完成",
      reason: "任务已确认完成",
      pending: [],
    };
  if (project?.status === "paused")
    return {
      kind: "project-paused",
      label: "项目暂停",
      reason: "恢复项目后再继续推进",
      pending,
    };
  if (project?.status === "done")
    return {
      kind: "project-closed",
      label: "项目已结束",
      reason: "项目已标记完成，如需继续请先恢复项目",
      pending,
    };
  if (!project)
    return {
      kind: "project-missing",
      label: "项目不存在",
      reason: "请重新关联有效项目",
      pending,
    };
  if (pending.length)
    return {
      kind: "blocked",
      label: "等待前置",
      reason: `先完成：${pending.map((t) => t.title).join("、")}`,
      pending,
    };
  if (task.status === "review")
    return {
      kind: "review",
      label: "待验收",
      reason: task.result
        ? "交付物已保存，等待你的判断"
        : "尚未填写交付物，请先补充",
      pending,
    };
  if (!owner)
    return {
      kind: "unassigned",
      label: "待分配",
      reason: "还没有负责人，需要安排分工",
      pending,
    };
  if (owner.availability === "paused")
    return {
      kind: "member-paused",
      label: "员工暂停",
      reason: `${owner.name}已暂停接单，先恢复或更换负责人`,
      pending,
    };
  if (task.status === "doing")
    return {
      kind: "doing",
      label: "进行中",
      reason: task.reviewNote
        ? `待修改：${task.reviewNote}`
        : "任务已标记进行中，可以继续完善交付物",
      pending,
    };
  return {
    kind: "ready",
    label: "可开始",
    reason: task.dependsOn?.length
      ? "前置任务已完成，可以继续推进"
      : "无前置阻塞，可以开始",
    pending,
  };
}

export function actionableTasks(workspace, today, projectId = "") {
  const priority = { high: 0, medium: 1, low: 2 };
  const order = {
    review: 0,
    unassigned: 1,
    "member-paused": 2,
    doing: 3,
    ready: 4,
    blocked: 5,
  };
  return workspace.tasks
    .filter((t) => !projectId || t.projectId === projectId)
    .map((task) => ({
      task,
      signal: taskReadiness(
        task,
        workspace.tasks,
        workspace.members,
        workspace.projects,
      ),
      overdue: task.deadline < today && task.status !== "done",
    }))
    .filter((item) => item.signal.kind in order)
    .sort(
      (a, b) =>
        (order[a.signal.kind] === 0 ? -1 : 0) -
          (order[b.signal.kind] === 0 ? -1 : 0) ||
        Number(b.overdue) - Number(a.overdue) ||
        order[a.signal.kind] - order[b.signal.kind] ||
        (priority[a.task.priority] ?? 1) - (priority[b.task.priority] ?? 1) ||
        a.task.deadline.localeCompare(b.task.deadline) ||
        a.task.id.localeCompare(b.task.id),
    );
}

export function downstreamIds(taskId, tasks) {
  const children = new Map();
  for (const task of tasks)
    for (const parent of task.dependsOn || []) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(task.id);
    }
  const seen = new Set([taskId]);
  const queue = [taskId];
  for (let i = 0; i < queue.length; i++)
    for (const child of children.get(queue[i]) || []) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  seen.delete(taskId);
  return [...seen];
}

export function taskLayers(tasks) {
  const ids = new Set(tasks.map((t) => t.id));
  const degree = new Map();
  const depth = new Map();
  const children = new Map();
  for (const task of tasks) {
    const deps = (task.dependsOn || []).filter((id) => ids.has(id));
    degree.set(task.id, deps.length);
    depth.set(task.id, 0);
    for (const id of deps) {
      if (!children.has(id)) children.set(id, []);
      children.get(id).push(task.id);
    }
  }
  const queue = tasks.filter((t) => degree.get(t.id) === 0).map((t) => t.id);
  for (let i = 0; i < queue.length; i++)
    for (const child of children.get(queue[i]) || []) {
      depth.set(child, Math.max(depth.get(child), depth.get(queue[i]) + 1));
      degree.set(child, degree.get(child) - 1);
      if (!degree.get(child)) queue.push(child);
    }
  if (queue.length !== tasks.length) return [];
  const groups = [];
  for (const task of tasks) {
    const level = depth.get(task.id);
    if (!groups[level]) groups[level] = [];
    groups[level].push(task);
  }
  return groups;
}
