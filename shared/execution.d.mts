import type { Task, Member, Project, Workspace } from "../src/domain";
export type Readiness = {
  kind:
    | "done"
    | "project-paused"
    | "project-closed"
    | "project-missing"
    | "blocked"
    | "review"
    | "unassigned"
    | "member-paused"
    | "doing"
    | "ready";
  label: string;
  reason: string;
  pending: Task[];
};
export function taskReadiness(
  task: Task,
  tasks: Task[],
  members: Member[],
  projects: Project[],
): Readiness;
export function actionableTasks(
  workspace: Workspace,
  today: string,
  projectId?: string,
): { task: Task; signal: Readiness; overdue: boolean }[];
export function downstreamIds(taskId: string, tasks: Task[]): string[];
export function taskLayers(tasks: Task[]): Task[][];
