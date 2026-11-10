export function taskKnowledgeId(taskId: string): string;
export function syncDeliveredKnowledge<T extends { tasks: unknown[]; knowledge: unknown[] }>(
  state: T,
  now?: string,
): T;
