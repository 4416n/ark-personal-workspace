import { dateIn, type Member, type Workspace, type Task } from "./domain";
export const tones = ["purple", "blue", "orange", "green", "pink"] as const;
export function departmentNames(s: Workspace) {
  return [
    ...new Set([
      ...s.members.map((m) => m.department),
      ...s.departments.map((d) => d.name),
    ]),
  ];
}
export function departmentStats(s: Workspace, name: string) {
  const members = s.members.filter((m) => m.department === name);
  const tasks = s.tasks.filter((t) => members.some((m) => m.id === t.ownerId));
  const active = tasks.filter((t) => t.status !== "done");
  const capacity = members
    .filter((m) => m.availability !== "paused")
    .reduce((a, m) => a + m.capacity, 0);
  const hours = active.reduce((a, t) => a + t.estimatedHours, 0);
  return {
    members,
    tasks,
    active,
    hours,
    capacity,
    load: capacity ? Math.round((hours / capacity) * 100) : hours ? 100 : 0,
    done: tasks.filter((t) => t.status === "done").length,
    overdue: active.filter((t) => t.deadline < dateIn()).length,
    review: active.filter((t) => t.status === "review").length,
    color:
      members[0]?.color ||
      tones[departmentNames(s).indexOf(name) % tones.length] ||
      "purple",
  };
}
export function memberLoad(s: Workspace, member: Member) {
  const tasks = s.tasks.filter(
    (t) => t.ownerId === member.id && t.status !== "done",
  );
  const hours = tasks.reduce((a, t) => a + t.estimatedHours, 0);
  return { tasks, hours, load: Math.round((hours / member.capacity) * 100) };
}
export function pendingDependencies(task: Task, tasks: Task[]) {
  return tasks.filter(
    (t) => task.dependsOn?.includes(t.id) && t.status !== "done",
  );
}
export function workspaceRisks(s: Workspace) {
  return [
    ...s.tasks
      .filter((t) => t.status === "review")
      .map((t) => ({
        id: `review-${t.id}`,
        kind: "review" as const,
        title: t.title,
        detail: "交付物已准备好，等待你的验收",
        task: t,
      })),
    ...s.tasks
      .filter((t) => t.status !== "done" && !t.ownerId)
      .map((t) => ({
        id: `assign-${t.id}`,
        kind: "unassigned" as const,
        title: t.title,
        detail: "尚未安排负责人，建议先完成分工",
        task: t,
      })),
    ...s.tasks
      .filter((t) => t.status !== "done" && t.deadline < dateIn())
      .map((t) => ({
        id: `overdue-${t.id}`,
        kind: "overdue" as const,
        title: t.title,
        detail: `已超过计划日期 ${t.deadline}，请调整排期`,
        task: t,
      })),
  ];
}
export function allocationWarnings(
  plan: { ownerId: string; estimatedHours: number }[],
  s: Workspace,
) {
  return s.members.flatMap((m) => {
    const added = plan
      .filter((t) => t.ownerId === m.id)
      .reduce(
        (sum, t) =>
          sum + (Number.isFinite(t.estimatedHours) ? t.estimatedHours : 0),
        0,
      );
    const { hours } = memberLoad(s, m);
    return added && (hours + added > m.capacity || m.availability === "paused")
      ? [
          `${m.name}：${m.availability === "paused" ? "已暂停接单" : `分配后 ${hours + added}/${m.capacity}h，超出 ${hours + added - m.capacity}h`}`,
        ]
      : [];
  });
}
