import {
  dateIn,
  uid,
  now,
  templateSchema,
  type Project,
  type ProjectTemplate,
  type Workspace,
  type Task,
} from "./domain.ts";
import { recommendedMember } from "../shared/matching.mjs";

export function projectToTemplate(
  project: Project,
  tasks: Task[],
  name: string,
): ProjectTemplate {
  const items = tasks.filter((t) => t.projectId === project.id);
  if (!items.length || items.length > 100)
    throw new Error("模板需要 1–100 个任务");
  const sorted: Task[] = [];
  const added = new Set<string>();
  while (sorted.length < items.length) {
    const ready = items.filter(
      (t) =>
        !added.has(t.id) && (t.dependsOn || []).every((id) => added.has(id)),
    );
    if (!ready.length) throw new Error("请先修复任务依赖关系");
    ready.forEach((t) => {
      sorted.push(t);
      added.add(t.id);
    });
  }
  return templateSchema.parse({
    id: uid(),
    name: name.trim(),
    goal: project.goal,
    deliveryType: project.deliveryType,
    successCriteria: project.successCriteria || "",
    createdAt: now(),
    tasks: sorted.map((t) => ({
      title: t.title,
      description: t.description,
      deliverable: t.deliverable,
      acceptanceCriteria: t.acceptanceCriteria,
      executionMode: t.executionMode,
      skills: t.skills || [],
      ownerId: t.ownerId,
      priority: t.priority,
      estimatedHours: t.estimatedHours,
      dayOffset: Math.round(
        (Date.parse(t.deadline) - Date.parse(project.deadline)) / 86400000,
      ),
      dependsOn: (t.dependsOn || []).map((id) =>
        sorted.findIndex((x) => x.id === id),
      ),
    })),
  });
}

export function instantiateTemplate(
  template: ProjectTemplate,
  state: Workspace,
  title: string,
  deadline = dateIn(14),
) {
  if (
    state.projects.length >= 2000 ||
    state.tasks.length + template.tasks.length > 10000
  )
    throw new Error("项目或任务数量已达到上限");
  const id = uid(),
    createdAt = now();
  const project: Project = {
    id,
    title: title.trim(),
    goal: template.goal,
    deliveryType: template.deliveryType,
    successCriteria: template.successCriteria,
    deadline,
    priority: "medium",
    status: "active",
    createdAt,
    color: "green",
    demo: false,
  };
  const ids = template.tasks.map(() => uid());
  const tasks: Task[] = [];
  template.tasks.forEach((item, index) => {
    const preferred = state.members.find(
      (m) => m.id === item.ownerId && m.availability !== "paused",
    );
    const ownerId =
      preferred?.id ||
      recommendedMember(
        item.skills,
        state.members,
        [...state.tasks, ...tasks],
        item.estimatedHours,
      ).ownerId;
    const date = new Date(`${deadline}T12:00:00`);
    date.setDate(date.getDate() + item.dayOffset);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    tasks.push({
      id: ids[index],
      projectId: id,
      title: item.title,
      description: item.description,
      deliverable: item.deliverable,
      acceptanceCriteria: item.acceptanceCriteria,
      executionMode: item.executionMode,
      skills: item.skills,
      ownerId,
      status: "todo",
      priority: item.priority,
      deadline: day,
      estimatedHours: item.estimatedHours,
      dependsOn: item.dependsOn.map((n) => ids[n]),
      result: "",
      source: "manual",
      createdAt,
      demo: false,
    });
  });
  return { project, tasks };
}
