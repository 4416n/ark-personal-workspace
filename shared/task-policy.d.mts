type Item = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  dependsOn?: string[];
};
export function dependencyError(tasks: Item[]): string;
export function transitionError(
  task: Item,
  status: string,
  tasks: Item[],
): string;
