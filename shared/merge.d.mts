import type { Workspace } from "../src/domain";
export function mergeWorkspace(
  base: Workspace,
  local: Workspace,
  remote: Workspace,
): { state: Workspace; conflicts: string[] };
