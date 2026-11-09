import { useEffect, useState } from "react";
import { uid } from "./domain";
export { useSyncedWorkspace as useWorkspace } from "./sync";
export const STORAGE_KEY = "ark-workspace-v1";
const active = new Map<string, string>();
const changed = () => window.dispatchEvent(new Event("ark-ai-calls"));
export function useActiveCalls() {
  const [calls, setCalls] = useState([...active.entries()]);
  useEffect(() => {
    const change = () => setCalls([...active.entries()]);
    window.addEventListener("ark-ai-calls", change);
    return () => window.removeEventListener("ark-ai-calls", change);
  }, []);
  return calls;
}
export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const tracked =
    ["/execute", "/chat", "/test"].includes(path) ||
    (path === "/plan" && (body as { mode?: string })?.mode === "ai");
  const runId = tracked ? uid() : "";
  if (runId) {
    active.set(runId, path);
    changed();
  }
  try {
    const response = await fetch(`/api${path}`, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers:
        body === undefined
          ? undefined
          : {
              "Content-Type": "application/json",
              ...(runId ? { "X-Run-Id": runId } : {}),
            },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(100000),
    });
    const data = await response.json().catch(() => ({
      error: "服务返回了无效响应，请检查本地服务是否正在运行。",
    }));
    if (!response.ok) throw new Error(data.error || "请求失败，请稍后重试");
    return data as T;
  } finally {
    if (runId) {
      active.delete(runId);
      changed();
    }
  }
}
export function download(
  name: string,
  text: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
