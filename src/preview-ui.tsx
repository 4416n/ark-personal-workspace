import { useEffect, useRef, useState } from "react";
import {
  Play,
  Square,
  RefreshCw,
  ArrowDown,
  ArrowUp,
  Monitor,
  Smartphone,
} from "lucide-react";
import { api } from "./store";
import "./preview.css";

type Frame = { png: string; width: number; height: number };
type Session = {
  id: string;
  buildId: string;
  sourceHash: string;
  expiresAt: number;
  idleExpiresAt: number;
  status: string;
  frame: Frame | null;
};
type Action =
  | { type: "click"; x: number; y: number }
  | { type: "text"; value: string }
  | { type: "key"; key: string }
  | { type: "scroll"; deltaY: number }
  | { type: "viewport"; mode: "desktop" | "mobile" }
  | { type: "frame" | "reload" | "restart" };

export function PreviewPanel({
  buildId,
  sourceHash,
  eligible,
  available,
}: {
  buildId: string;
  sourceHash: string;
  eligible: boolean;
  available: boolean;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [occupied, setOccupied] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [clock, setClock] = useState(Date.now());
  const active = useRef<Session | null>(null);
  const alive = useRef(true);
  const working = useRef(false);
  const generation = useRef(0);
  const stopping = useRef(false);
  const setCurrent = (next: Session | null) => {
    active.current = next;
    setSession(next);
  };
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void api<{ session: Session | null; occupied: boolean }>(
      `/software-builds/${buildId}/preview`,
    )
      .then((result) => {
        if (!cancelled) {
          setCurrent(result.session);
          setOccupied(result.occupied && !result.session);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      cancelled = true;
      alive.current = false;
      clearInterval(timer);
      const previous = active.current;
      active.current = null;
      if (previous)
        void fetch(`/api/previews/${previous.id}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => {});
    };
  }, [buildId]);
  const start = async () => {
    if (working.current) return;
    if (
      !confirm(
        "启动安全交互预览？将在 Linux 隔离环境中运行此版本，使用临时数据库，不调用模型。最多 10 分钟，90 秒无操作自动停止。请勿在预览中输入真实密钥或私人凭据。",
      )
    )
      return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api<Session>(`/software-builds/${buildId}/preview`, {
        confirmed: true,
        sourceHash,
      });
      if (alive.current) {
        setCurrent(result);
        setOccupied(false);
      } else await api(`/previews/${result.id}`, undefined, "DELETE");
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const stop = async () => {
    if (!active.current || stopping.current) return;
    const previous = active.current;
    stopping.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/previews/${previous.id}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok && ![404, 410].includes(response.status))
        throw new Error((await response.json()).error || "停止预览失败");
      if (alive.current && active.current?.id === previous.id) setCurrent(null);
    } catch (e) {
      if (alive.current)
        setError(`${(e as Error).message}；会话仍保留，请重试停止。`);
    } finally {
      stopping.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const action = async (value: Action) => {
    if (working.current || !active.current) return;
    const previous = active.current;
    const requestGeneration = generation.current;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api<Session>(
        `/previews/${previous.id}/action`,
        value,
      );
      if (
        alive.current &&
        requestGeneration === generation.current &&
        active.current?.id === previous.id
      ) {
        setCurrent(result);
        if (value.type === "text") setText("");
      }
    } catch (e) {
      if (alive.current && requestGeneration === generation.current)
        setError(`${(e as Error).message}；可点击停止预览以确认清理。`);
    } finally {
      working.current = false;
      if (alive.current && !stopping.current) setBusy(false);
    }
  };
  const ended =
    !!session && clock >= Math.min(session.expiresAt, session.idleExpiresAt);
  const frame = session?.frame;
  return (
    <section
      className="interactive-preview"
      aria-label="安全交互预览"
      aria-busy={busy}
    >
      <div className="interactive-preview-heading">
        <h4>安全交互预览</h4>
        {session && (
          <span className="pill neutral">
            {ended
              ? "会话已到期"
              : `剩余 ${Math.max(0, Math.ceil((Math.min(session.expiresAt, session.idleExpiresAt) - clock) / 1000))} 秒`}
          </span>
        )}
      </div>
      <p className="software-note">
        点击画面操作隔离浏览器；输入内容后发送到已选中的输入框。预览使用临时数据库，停止后清除数据，不代表最终验收。
      </p>
      {!session ? (
        <>
          {!available && (
            <p className="field-hint">
              需要可用的 Linux
              隔离环境；当前设备仍可下载源码和查看已有运行截图。
            </p>
          )}
          {available && !eligible && (
            <p className="field-hint">
              请先对当前需求对应的源码完成真实隔离验证，再启动预览。
            </p>
          )}
          {occupied && (
            <p className="field-hint">
              已有其他工程或设备占用预览，停止或到期后可重新启动。
            </p>
          )}
          <button
            className="button"
            disabled={busy || !available || !eligible}
            onClick={() => void start()}
          >
            <Play size={15} />
            {busy ? "正在启动隔离预览…" : "启动安全预览"}
          </button>
        </>
      ) : (
        <>
          <div className="preview-controls">
            <button
              className="button"
              disabled={!session}
              onClick={() => void stop()}
            >
              <Square size={14} />
              停止预览
            </button>
            <button
              className="button"
              disabled={busy || ended}
              onClick={() => void action({ type: "frame" })}
            >
              <RefreshCw size={14} />
              更新画面
            </button>
            <button
              className="button"
              disabled={busy || ended}
              onClick={() => void action({ type: "reload" })}
            >
              刷新页面
            </button>
            <button
              className="button"
              disabled={busy || ended}
              onClick={() => void action({ type: "restart" })}
            >
              重启并读回
            </button>
            <button
              className="button"
              disabled={busy || ended}
              onClick={() => void action({ type: "viewport", mode: "desktop" })}
            >
              <Monitor size={14} />
              桌面
            </button>
            <button
              className="button"
              disabled={busy || ended}
              onClick={() => void action({ type: "viewport", mode: "mobile" })}
            >
              <Smartphone size={14} />
              手机
            </button>
          </div>
          {frame && (
            <button
              className="preview-frame-button"
              aria-label="点击隔离预览画面"
              disabled={busy || ended}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                void action({
                  type: "click",
                  x: Math.min(
                    frame.width - 1,
                    Math.max(
                      0,
                      Math.floor(
                        ((event.clientX - bounds.left) / bounds.width) *
                          frame.width,
                      ),
                    ),
                  ),
                  y: Math.min(
                    frame.height - 1,
                    Math.max(
                      0,
                      Math.floor(
                        ((event.clientY - bounds.top) / bounds.height) *
                          frame.height,
                      ),
                    ),
                  ),
                });
              }}
            >
              <img
                src={`data:image/png;base64,${frame.png}`}
                alt="隔离浏览器的当前画面"
                draggable={false}
                width={frame.width}
                height={frame.height}
              />
            </button>
          )}
          <div className="preview-text-input">
            <label>
              发送到选中的输入框
              <input
                aria-label="预览输入文字"
                value={text}
                maxLength={2000}
                disabled={busy || ended}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <button
              className="button"
              disabled={busy || ended || !text}
              onClick={() => void action({ type: "text", value: text })}
            >
              发送文字
            </button>
          </div>
          <div className="preview-controls">
            <button
              className="button"
              disabled={busy || ended}
              onClick={() => void action({ type: "key", key: "Tab" })}
            >
              下一输入框
            </button>
            <button
              className="button"
              disabled={busy || ended}
              onClick={() => void action({ type: "key", key: "Control+A" })}
            >
              全选当前输入
            </button>
            <button
              className="button"
              disabled={busy || ended}
              onClick={() => void action({ type: "key", key: "Backspace" })}
            >
              删除
            </button>
            <button
              className="button"
              disabled={busy || ended}
              onClick={() => void action({ type: "key", key: "Enter" })}
            >
              回车
            </button>
            <button
              className="button"
              disabled={busy || ended}
              onClick={() => void action({ type: "scroll", deltaY: -500 })}
            >
              <ArrowUp size={14} />
              上翻
            </button>
            <button
              className="button"
              disabled={busy || ended}
              onClick={() => void action({ type: "scroll", deltaY: 500 })}
            >
              <ArrowDown size={14} />
              下翻
            </button>
          </div>
          <p className="field-hint">
            最多 10 分钟；90
            秒无操作回收。“更新画面”不会延长会话；重启会清除浏览器缓存并从临时数据库读回。关闭此工程面板也会停止预览。
          </p>
        </>
      )}
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
