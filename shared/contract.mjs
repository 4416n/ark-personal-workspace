// Old tasks remain usable, without pretending they had structured contracts.
export function taskContract(task) {
  const match = /交付物[：:]([^\n]+)/.exec(task.description || "");
  const acceptance = /验收[：:]([^\n]+)/.exec(task.description || "");
  return {
    deliverable:
      task.deliverable?.trim() ||
      match?.[1]?.trim().slice(0, 300) ||
      `${task.title} · Markdown 成果`.slice(0, 300),
    acceptanceCriteria: task.acceptanceCriteria?.length
      ? task.acceptanceCriteria
      : [
          (
            acceptance?.[1] ||
            task.description ||
            "直接提供可使用的成果，而非仅列待办"
          ).slice(0, 1000),
          "交付内容可直接阅读或编辑使用；说明使用方式、假设和待确认事项",
          "不虚构事实、来源、测试结果或已完成的外部操作",
        ],
    executionMode: task.executionMode || "ai",
  };
}
export const reviewBasis = (t) =>
  JSON.stringify([
    t.title,
    t.description,
    taskContract(t),
    t.ownerId,
    t.dependsOn || [],
  ]);

export function deliveryMarkdown(project, tasks) {
  const done = tasks.filter((t) => t.status === "done").length;
  return (
    `# ${project.title} · 交付包\n\n目标：${project.goal}\n\n项目验收标准：${project.successCriteria || "未设置"}\n\n任务完成 ${done}/${tasks.length}。AI 审查不是人工验收；文本完成不代表已发布、执行或实现业务目标。\n\n` +
    tasks
      .map((t, i) => {
        const c = taskContract(t);
        const review =
          t.aiReview?.versionId === t.resultMeta?.id ? t.aiReview : null;
        return `## ${i + 1}. ${c.deliverable}\n\n任务：${t.title}\n状态：${{ todo: "待开始", doing: "进行中", review: "待验收", done: "已完成" }[t.status]}\n交付形式：${c.executionMode === "human" ? "需要人工操作" : "文本 / 代码草稿"}\n\n### 验收清单\n${c.acceptanceCriteria.map((x) => `- ${x}`).join("\n")}\n\n### 审查记录\n${review ? `AI 审查：${review.passed ? "通过" : "未通过"}（${review.model}）\n${review.summary}\n${review.checks.map((x) => `- [${x.passed ? "x" : " "}] ${x.criterion}：${x.evidence}`).join("\n")}` : "本版暂无 AI 审查记录"}\n${(
          t.reviews || []
        )
          .slice(0, 3)
          .map(
            (r) =>
              `- ${r.actor === "ai" ? "AI" : "人工"}${r.action === "approved" ? "通过" : "退回"}：${r.note}`,
          )
          .join(
            "\n",
          )}\n\n### 交付正文\n\n${t.result || "尚未生成交付物"}\n\n${t.resultSources?.length ? "### 参考资料\n" + t.resultSources.map((s) => `- [${s.citation}] ${s.title}（字符 ${s.start + 1}–${s.end}）`).join("\n") : ""}`;
      })
      .join("\n\n---\n\n")
  );
}
