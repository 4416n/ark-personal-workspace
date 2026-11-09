import { useEffect, useRef, useState } from "react";
import {
  stateSchema,
  seedWorkspace,
  emptyWorkspace,
  uid,
  now,
  type Workspace,
} from "./domain";
import { boundWorkspaceHistory } from "./delivery";
import { mergeWorkspace } from "../shared/merge.mjs";

const KEY = "ark-workspace-v1";
const PENDING = "ark-workspace-pending-v3";
export type Session = {
  shared: boolean;
  local: boolean;
  authenticated: boolean;
  initialized: boolean;
  lan: boolean;
};
type Snapshot = { state: Workspace; revision: number };
async function request(path: string, data?: unknown) {
  const r = await fetch(`/api${path}`, {
    method: data ? "PUT" : "GET",
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  const result = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(result.error || "无法连接电脑"), {
      status: r.status,
    });
  return result;
}
export function useSyncedWorkspace() {
  const [loaded] = useState(() => {
    let raw = "";
    try {
      raw = localStorage.getItem(KEY) || "";
      return {
        state: raw ? stateSchema.parse(JSON.parse(raw)) : seedWorkspace(),
        recovery: "",
        raw,
      };
    } catch {
      return { state: emptyWorkspace(), recovery: raw, raw };
    }
  });
  const [state, setState] = useState(loaded.state);
  const stateRef = useRef(state);
  const base = useRef<Snapshot | null>(null);
  const dirty = useRef(false);
  const running = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState("正在连接电脑…");
  const [storageError, setError] = useState("");
  const [conflict, setConflict] = useState<Snapshot | null>(null);
  const conflictRef = useRef<Snapshot | null>(null);
  const [bootError, setBootError] = useState("");
  const cache = (value: Workspace) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      setError("浏览器缓存空间不足，请导出备份；以电脑保存状态为准。");
    }
  };
  const cachePending = () => {
    if (!base.current) return;
    try {
      localStorage.setItem(
        PENDING,
        JSON.stringify({ base: base.current, state: stateRef.current }),
      );
    } catch {
      setError("待同步修改无法缓存在浏览器，请保持页面开启并导出备份。");
    }
  };
  const adopt = (value: Workspace) => {
    stateRef.current = value;
    setState(value);
    cache(value);
  };
  const markConflict = (remote: Snapshot) => {
    conflictRef.current = remote;
    setConflict(remote);
    setStatus("两台设备修改了相同内容，请选择保留版本");
  };
  const pump = async () => {
    if (
      !readyRef.current ||
      !sessionRef.current?.shared ||
      !base.current ||
      running.current ||
      conflictRef.current
    )
      return;
    running.current = true;
    try {
      if (dirty.current) {
        setStatus("正在保存到电脑…");
        const submitted = stateRef.current;
        try {
          const saved: Snapshot = await request("/workspace", {
            state: submitted,
            revision: base.current.revision,
          });
          base.current = { ...saved, state: stateSchema.parse(saved.state) };
          if (stateRef.current === submitted) {
            dirty.current = false;
            localStorage.removeItem(PENDING);
            setStatus("已保存到电脑");
          } else cachePending();
        } catch (e) {
          if ((e as { status?: number }).status !== 409) throw e;
          const remote: Snapshot = await request("/workspace");
          remote.state = stateSchema.parse(remote.state);
          const merged = mergeWorkspace(
            base.current.state,
            stateRef.current,
            remote.state,
          );
          if (
            merged.conflicts.length ||
            !stateSchema.safeParse(merged.state).success
          )
            markConflict(remote);
          else {
            base.current = remote;
            adopt(merged.state);
            cachePending();
            setStatus("已合并其他设备修改，正在保存…");
          }
        }
      } else if (
        !document.querySelector('[role="dialog"]') &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName || "",
        )
      ) {
        const remote: Snapshot = await request(
          `/workspace?revision=${base.current.revision}`,
        );
        if (!dirty.current && remote.revision !== base.current.revision) {
          remote.state = stateSchema.parse(remote.state);
          base.current = remote;
          adopt(remote.state);
        }
        if (!dirty.current) setStatus("已保存到电脑");
      }
    } catch (error) {
      if ([400, 413].includes((error as { status?: number }).status || 0)) {
        setError((error as Error).message);
        setStatus("修改尚未保存到电脑，请检查内容或导出备份");
        return;
      }
      if ((error as { status?: number }).status === 401) {
        const next = { ...sessionRef.current!, authenticated: false };
        sessionRef.current = next;
        setSession(next);
      }
      setStatus(
        dirty.current
          ? "电脑连接中断，修改暂存本机，重连后同步"
          : "电脑连接中断，显示上次缓存",
      );
    } finally {
      running.current = false;
    }
  };
  const pumpRef = useRef(pump);
  pumpRef.current = pump;
  useEffect(() => {
    let alive = true;
    const boot = async () => {
      try {
        const info: Session = await request("/session");
        if (!alive) return;
        setSession(info);
        sessionRef.current = info;
        if (!info.authenticated) {
          setReady(true);
          return;
        }
        if (loaded.recovery)
          localStorage.setItem(
            `${KEY}-recovery-${Date.now()}`,
            loaded.recovery,
          );
        if (!info.shared) {
          cache(loaded.state);
          setStatus("浏览器独立保存");
        } else {
          let remote = (await request("/workspace")) as Snapshot;
          if (!alive) return;
          if (!remote.state) {
            if (!info.local)
              throw new Error("请先在电脑打开工作台，完成数据初始化");
            if (loaded.recovery)
              throw new Error(
                "旧浏览器数据损坏，请先导出原始数据再恢复，不会用空数据覆盖电脑",
              );
            if (
              loaded.raw &&
              !localStorage.getItem(`${KEY}-before-server-migration`)
            )
              localStorage.setItem(
                `${KEY}-before-server-migration`,
                loaded.raw,
              );
            remote = await request("/workspace", {
              state: loaded.state,
              revision: 0,
            });
          }
          remote.state = stateSchema.parse(remote.state);
          base.current = remote;
          const pendingRaw = localStorage.getItem(PENDING);
          if (pendingRaw) {
            const pending = JSON.parse(pendingRaw);
            const pendingState = stateSchema.parse(pending.state);
            const merged = mergeWorkspace(
              stateSchema.parse(pending.base.state),
              pendingState,
              remote.state,
            );
            dirty.current = true;
            if (
              merged.conflicts.length ||
              !stateSchema.safeParse(merged.state).success
            ) {
              adopt(pendingState);
              markConflict(remote);
            } else {
              adopt(merged.state);
              cachePending();
            }
          } else {
            if (
              loaded.raw &&
              loaded.raw !== JSON.stringify(remote.state) &&
              !localStorage.getItem(`${KEY}-before-server-migration`)
            )
              localStorage.setItem(
                `${KEY}-before-server-migration`,
                loaded.raw,
              );
            adopt(remote.state);
          }
          if (!conflictRef.current)
            setStatus(dirty.current ? "正在同步暂存修改…" : "已保存到电脑");
        }
        if (alive) {
          readyRef.current = true;
          setReady(true);
        }
      } catch (e) {
        if (alive) setBootError((e as Error).message);
      }
    };
    void boot();
    const timer = setInterval(() => void pumpRef.current(), 2000);
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("beforeunload", leave);
    };
  }, []);
  const update = (fn: (s: Workspace) => Workspace, activity?: string) => {
    if (!readyRef.current) return;
    let next = fn(stateRef.current);
    if (activity) {
      if (next.tasks !== stateRef.current.tasks)
        next = { ...next, tasks: boundWorkspaceHistory(next.tasks) };
      next = {
        ...next,
        activity: [
          { id: uid(), text: activity, at: now() },
          ...next.activity,
        ].slice(0, 100),
      };
    }
    adopt(next);
    if (sessionRef.current?.shared) {
      dirty.current = true;
      cachePending();
      if (!conflictRef.current) setStatus("正在保存到电脑…");
      void pumpRef.current();
    }
  };
  const resolve = (choice: "local" | "remote") => {
    if (!conflictRef.current) return;
    base.current = conflictRef.current;
    if (choice === "remote") {
      adopt(base.current.state);
      dirty.current = false;
      localStorage.removeItem(PENDING);
    } else {
      dirty.current = true;
      cachePending();
    }
    conflictRef.current = null;
    setConflict(null);
    setStatus("正在同步…");
    void pumpRef.current();
  };
  return {
    state,
    update,
    storageError,
    recovery: loaded.recovery,
    ready,
    session,
    status,
    conflict,
    resolve,
    bootError,
  };
}
