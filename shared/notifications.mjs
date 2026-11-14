function contentVersion(content) {
  let hash = 5381;
  for (const character of content) hash = ((hash * 33) ^ character.codePointAt(0)) >>> 0;
  return hash.toString(16);
}

export function workspaceNotices(workspace, runs = [], today = new Date().toLocaleDateString("en-CA")) {
  const projects = new Map(workspace.projects.map((project) => [project.id, project]));
  const notices = [];
  for (const task of workspace.tasks) {
    const project = projects.get(task.projectId);
    if (!project || project.status !== "active" || task.status === "done") continue;
    const base = { title: task.title, project: project.title, taskId: task.id, projectId: project.id };
    if (task.status === "review") {
      notices.push({ ...base, id: `review:${task.id}:${task.resultMeta?.id || contentVersion(task.result)}`, kind: "review", label: "待验收", detail: "打开成果，确认通过或填写返工意见。", rank: 0 });
    } else if (task.deadline < today) {
      notices.push({ ...base, id: `overdue:${task.id}:${task.deadline}`, kind: "overdue", label: "已逾期", detail: `截止 ${task.deadline}，请调整计划或推进任务。`, rank: 1 });
    } else if (!task.ownerId) {
      notices.push({ ...base, id: `unassigned:${task.id}`, kind: "unassigned", label: "待分配", detail: "尚未指定负责人，打开任务安排分工。", rank: 2 });
    } else if (task.deadline === today) {
      notices.push({ ...base, id: `today:${task.id}:${today}`, kind: "today", label: "今日到期", detail: "今天是计划截止日，请检查进度。", rank: 3 });
    }
  }
  for (const run of runs) {
    if (!["failed", "succeeded"].includes(run.status) || run.kind === "test") continue;
    notices.push({
      id: `run:${run.id}:${run.status}`,
      title: run.label || "AI 执行",
      kind: run.status === "failed" ? "failed" : "completed",
      label: run.status === "failed" ? "执行失败" : "执行完成",
      detail: run.status === "failed" ? "打开 AI 执行记录查看原因，再决定是否重试。" : "打开 AI 执行记录查看本次成果。",
      runId: run.id,
      rank: run.status === "failed" ? 1 : 4,
      at: run.finishedAt || run.startedAt,
    });
  }
  return notices.sort((first, second) => first.rank - second.rank || (second.at || "").localeCompare(first.at || "") || first.title.localeCompare(second.title, "zh-CN"));
}
