import type { Workspace } from "../src/domain";
export type NoticeRun = { id: string; kind: string; status: string; label: string; startedAt: string; finishedAt?: string };
export type WorkspaceNotice = {
  id: string;
  title: string;
  kind: string;
  label: string;
  detail: string;
  rank: number;
  project?: string;
  taskId?: string;
  projectId?: string;
  runId?: string;
  at?: string;
};
export function workspaceNotices(workspace: Workspace, runs?: NoticeRun[], today?: string): WorkspaceNotice[];
