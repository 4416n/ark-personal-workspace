import type { Task, Project } from "../src/domain.ts";
export function taskContract(
  task: Pick<
    Task,
    | "title"
    | "description"
    | "deliverable"
    | "acceptanceCriteria"
    | "executionMode"
  >,
): {
  deliverable: string;
  acceptanceCriteria: string[];
  executionMode: "ai" | "human";
};
export function deliveryMarkdown(project: Project, tasks: Task[]): string;
export function reviewBasis(task: Task): string;
