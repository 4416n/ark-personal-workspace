import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, CheckCheck, ChevronRight, RefreshCw } from "lucide-react";
import { useApp } from "./context";
import { api } from "./store";
import { Modal } from "./components";
import { dateIn } from "./domain";
import { workspaceNotices, type NoticeRun, type WorkspaceNotice } from "../shared/notifications.mjs";
import "./notifications.css";

const storageKey = "ark-notice-read-v1";
function readSeen(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(-500) : [];
  } catch { return []; }
}

export function NotificationCenter() {
  const { state, open, navigate } = useApp();
  const [visible, setVisible] = useState(false);
  const [tab, setTab] = useState("pending");
  const [seen, setSeen] = useState(readSeen);
  const [runs, setRuns] = useState<NoticeRun[]>([]);
  const [error, setError] = useState("");
  const [today, setToday] = useState(() => dateIn());
  const refresh = async () => {
    try {
      setRuns(await api<NoticeRun[]>("/runs"));
      setError("");
    } catch { setError("执行提醒暂时无法更新，任务提醒仍可查看。"); }
  };
  useEffect(() => {
    let active = true;
    const update = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const next = await api<NoticeRun[]>("/runs");
        if (active) { setRuns(next); setError(""); }
      } catch { if (active) setError("执行提醒暂时无法更新，任务提醒仍可查看。"); }
      if (active) setToday(dateIn());
    };
    void update();
    const timer = setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    const synchronize = (event: StorageEvent) => {
      if (event.key === storageKey) setSeen(readSeen());
    };
    window.addEventListener("storage", synchronize);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("storage", synchronize);
    };
  }, []);
  const notices = workspaceNotices(state, runs, today);
  const unread = notices.filter((notice) => !seen.includes(notice.id)).length;
  const markRead = (ids: string[]) => {
    const next = [...new Set([...seen, ...ids])].slice(-500);
    setSeen(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  };
  const showNotice = (notice: WorkspaceNotice) => {
    markRead([notice.id]);
    setVisible(false);
    if (notice.taskId) open({ type: "task", id: notice.taskId });
    else navigate("runs");
  };
  const pending = notices.filter((notice) => notice.kind !== "completed");
  const completed = notices.filter((notice) => notice.kind === "completed");
  const list = tab === "pending" ? pending : completed;
  return (
    <>
      <button className="icon-button notification-button" aria-label="查看工作台动态" aria-haspopup="dialog" onClick={() => { setVisible(true); void refresh(); }}>
        <Bell size={19} />
        {unread > 0 && <span className="notice-count" aria-label={`${unread} 条未读提醒`}>{unread > 99 ? "99+" : unread}</span>}
      </button>
      {visible && createPortal(
        <Modal title="工作台动态" subtitle="待验收、截止提醒和 AI 执行结果，集中处理。" onClose={() => setVisible(false)}>
          <div className="modal-body notice-center">
            <div className="notice-toolbar">
              <div role="group" aria-label="提醒分类">
                <button className={`button ${tab === "pending" ? "primary" : ""}`} aria-pressed={tab === "pending"} onClick={() => setTab("pending")}>待处理 {pending.length}</button>
                <button className={`button ${tab === "completed" ? "primary" : ""}`} aria-pressed={tab === "completed"} onClick={() => setTab("completed")}>已完成 {completed.length}</button>
              </div>
              <button className="button" onClick={() => markRead(notices.map((notice) => notice.id))}><CheckCheck size={15} />全部标为已读</button>
            </div>
            {error && <p role="status">{error} <button className="text-button" onClick={() => void refresh()}><RefreshCw size={12} />重试</button></p>}
            <p className="field-hint">已读不会完成任务或改变验收结果。提醒只在工作台内显示。</p>
            <div className="notice-list">
              {list.slice(0, 100).map((notice) => (
                <button key={notice.id} className={`notice-item ${seen.includes(notice.id) ? "is-read" : ""}`} onClick={() => showNotice(notice)}>
                  <span className={`pill ${["failed", "overdue"].includes(notice.kind) ? "orange" : "green"}`}>{notice.label}</span>
                  <span className="notice-copy"><strong>{notice.title}</strong>{notice.project && <small>{notice.project}</small>}<span>{notice.detail}</span></span>
                  <ChevronRight size={16} />
                </button>
              ))}
              {!list.length && <div className="notice-empty"><CheckCheck size={28} /><p>{tab === "pending" ? "目前没有待处理提醒" : "暂无已完成的 AI 执行"}</p></div>}
              {list.length > 100 && <p className="field-hint">显示前 100 条，其余请在任务看板和 AI 执行记录中查看。</p>}
            </div>
            <details className="notice-history"><summary>最近工作台记录</summary>{state.activity.slice(0, 10).map((item) => <p key={item.id}>{item.text}<small>{new Date(item.at).toLocaleString("zh-CN")}</small></p>)}{!state.activity.length && <p>还没有新的动态</p>}</details>
          </div>
        </Modal>, document.body
      )}
    </>
  );
}
