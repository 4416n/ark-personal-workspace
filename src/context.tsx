import { createContext, useContext } from "react";
import type { AiConfig, Page, Workspace } from "./domain";
import type { Session } from "./sync";
export type DialogState =
  | { type: "project-new"; goal?: string }
  | { type: "department"; name: string }
  | { type: "project"; id: string; section?: "auto" | "software" }
  | { type: "task"; id?: string; projectId?: string }
  | { type: "member"; id?: string }
  | { type: "staff-work"; id: string }
  | { type: "knowledge"; id?: string }
  | null;
export type AppContextType = {
  state: Workspace;
  update: (fn: (s: Workspace) => Workspace, activity?: string) => void;
  config: AiConfig | null;
  refreshConfig: () => Promise<void>;
  navigate: (page: Page) => void;
  open: (dialog: DialogState) => void;
  notify: (message: string, error?: boolean) => void;
  session?: Session | null;
  syncNow: () => Promise<number>;
};
export const AppContext = createContext<AppContextType | null>(null);
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("工作台上下文未就绪");
  return context;
}
