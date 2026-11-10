import type { Member, Project, Task } from "../src/domain";
export function resultPreview(text: string, limit?: number): string;
export function safeFileName(name: string): string;
export function deliverableFiles(
  project: Project,
  tasks: Task[],
  members?: Member[],
): { name: string; content: string }[];
export function zipStore(files: { name: string; content: string }[]): Uint8Array;
