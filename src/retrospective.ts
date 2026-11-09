import type { Member, Project, Retrospective, Task } from "./domain.ts";

export type RetroNotes = Pick<
  Retrospective,
  "outcome" | "lessons" | "nextSteps"
>;
export const emptyRetro: RetroNotes = {
  outcome: "",
  lessons: "",
  nextSteps: "",
};

export function projectFacts(tasks: Task[]) {
  return {
    total: tasks.length,
    done: tasks.filter((t) => t.status === "done").length,
    delivered: tasks.filter((t) => t.result.trim()).length,
    hours: tasks.reduce((n, t) => n + t.estimatedHours, 0),
    returned: tasks.reduce(
      (n, t) =>
        n + (t.reviews || []).filter((r) => r.action === "returned").length,
      0,
    ),
    approved: tasks.reduce(
      (n, t) =>
        n + (t.reviews || []).filter((r) => r.action === "approved").length,
      0,
    ),
  };
}

export function retrospectiveMarkdown(
  project: Project,
  tasks: Task[],
  members: Member[],
  notes: RetroNotes,
  at = new Date().toISOString(),
) {
  const f = projectFacts(tasks);
  const status = {
    todo: "待开始",
    doing: "进行中",
    review: "待验收",
    done: "已完成",
  };
  const pending = tasks.filter((t) => t.status !== "done");
  const delivered = tasks.filter((t) => t.result.trim());
  const reviews = tasks
    .flatMap((t) => (t.reviews || []).map((r) => ({ ...r, title: t.title })))
    .sort((a, b) => b.at.localeCompare(a.at));
  const ownerNames = new Map(members.map((m) => [m.id, m.name]));
  const excerpt = (s: string, n: number) =>
    s.length > n ? s.slice(0, n) + "\n…（节选，完整内容见任务）" : s;
  return [
    `# ${project.title} · 项目复盘`,
    `生成时间：${at}\n项目状态：${{ active: "进行中", paused: "已暂停", done: "已完成" }[project.status]}${project.demo ? "\n示例项目，非真实经营数据。" : ""}`,
    `## 目标与验收\n\n${project.goal}\n\n验收标准：${project.successCriteria || "尚未设置"}\n截止日期：${project.deadline}`,
    `## 执行概况\n\n- 任务完成：${f.done}/${f.total}\n- 已有交付物：${f.delivered} 项\n- 留存审批：通过 ${f.approved} 条，返工 ${f.returned} 条\n- 计划工时：${f.hours}h（非实际耗时）\n- 计划预算：¥${project.budget || 0}（非实际支出）\n\n任务完成状态不等同于验收记录；审批统计仅包含留存记录。`,
    `## 实际达成情况\n\n${notes.outcome || "待补充：对照验收标准，写下实际达成和未达成的部分。"}`,
    `## 交付物摘要\n\n${
      delivered.length
        ? delivered
            .slice(0, 12)
            .map(
              (t) =>
                `### ${t.title}\n\n${status[t.status]} · ${ownerNames.get(t.ownerId) || "待分配"}${t.resultMeta ? ` · V${t.resultMeta.number}` : ""}\n\n${excerpt(t.result, 600)}`,
            )
            .join("\n\n")
        : "暂无交付物。"
    }${delivered.length > 12 ? `\n\n仅列出前 12 项，共 ${delivered.length} 项。` : ""}`,
    `## 尚待推进\n\n${
      pending.length
        ? pending
            .slice(0, 30)
            .map(
              (t) =>
                `- ${t.title}｜${status[t.status]}｜${ownerNames.get(t.ownerId) || "待分配"}｜截止 ${t.deadline}`,
            )
            .join("\n")
        : f.total
          ? "全部任务已标记完成。"
          : "尚未建立执行任务。"
    }${pending.length > 30 ? `\n仅列出前 30 项，共 ${pending.length} 项。` : ""}`,
    `## 审批与返工\n\n${
      reviews.length
        ? reviews
            .slice(0, 20)
            .map(
              (r) =>
                `- ${r.at.slice(0, 10)} ${r.title}${r.versionNumber ? ` V${r.versionNumber}` : ""} · ${r.action === "approved" ? "通过" : "退回"}：${excerpt(r.note, 500)}`,
            )
            .join("\n")
        : "暂无留存审批记录；旧版意见可在任务中查看。"
    }${reviews.length > 20 ? "\n仅列出最近 20 条留存审批。" : ""}`,
    `## 可复用经验\n\n${notes.lessons || "待补充：哪些做法有效，哪些需要调整？"}`,
    `## 下一步行动\n\n${notes.nextSteps || "待补充：接下来要验证或改进什么？"}`,
  ].join("\n\n");
}
