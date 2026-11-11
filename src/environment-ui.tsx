import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, MonitorCheck, RotateCw } from "lucide-react";
import { useApp } from "./context";
import { api } from "./store";

export type EnvironmentStatus = {
  available: boolean;
  reason: string;
  platform?: string;
  nodeVersion?: string;
  checkedAt?: string;
  checks?: {
    id: string;
    label: string;
    status: "passed" | "failed" | "unsupported";
    detail: string;
    action?: string;
  }[];
};

export function EnvironmentChecks({ status }: { status: EnvironmentStatus }) {
  return (
    <ul className="environment-checks" aria-label="工程环境检查项">
      {status.checks?.map((check) => (
        <li key={check.id} className={`environment-check ${check.status}`}>
          <div className="environment-check-heading">
            {check.status === "passed" ? (
              <Check size={16} />
            ) : (
              <CircleAlert size={16} />
            )}
            <strong>{check.label}</strong>
            <span
              className={`pill ${check.status === "passed" ? "green" : "neutral"}`}
            >
              {check.status === "passed"
                ? "通过"
                : check.status === "failed"
                  ? "需要处理"
                  : check.id === "platform"
                    ? "暂不支持"
                    : "未检测"}
            </span>
          </div>
          <p>{check.detail}</p>
          {check.action && (
            <p className="environment-action">下一步：{check.action}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function EnvironmentPanel() {
  const { session } = useApp();
  const [status, setStatus] = useState<EnvironmentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(false);
  const checking = useRef(false);
  const inspect = async (refresh = false) => {
    if (checking.current) return;
    checking.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api<EnvironmentStatus>(
        `/software-capabilities${refresh ? "?refresh=1" : ""}`,
      );
      if (alive.current) setStatus(result);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      checking.current = false;
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    if (session?.shared) void inspect();
    return () => {
      alive.current = false;
    };
  }, [session?.shared]);
  if (!session?.shared) return null;
  return (
    <section
      className="panel settings-section environment-panel"
      aria-label="工程验证环境"
    >
      <div className="settings-title">
        <span className="settings-icon green">
          <MonitorCheck size={20} />
        </span>
        <div>
          <h2>工程验证环境</h2>
          <p>开始网站工程前，检查电脑能否实际构建和验证交付物。</p>
        </div>
      </div>
      <p className="field-hint">
        检查电脑端环境，不调用
        AI，也不消耗模型费用。基础工作台与文档任务不受工程验证环境限制。
      </p>
      <div className="inline-controls feature-actions">
        <button
          className="button"
          disabled={busy}
          onClick={() => void inspect(true)}
        >
          <RotateCw size={15} />
          {busy ? "正在检查环境…" : "重新检查环境"}
        </button>
        {status?.checkedAt && (
          <span className="field-hint">
            检查于 {new Date(status.checkedAt).toLocaleTimeString("zh-CN")}；5
            秒内复用最近结果。
          </span>
        )}
      </div>
      {busy && <p role="status">正在检查隔离工具与运行依赖…</p>}
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <>
          <p
            className={`alert ${status.available ? "" : "environment-unavailable"}`}
          >
            <strong>
              {status.available
                ? "隔离验证环境已就绪。"
                : "当前只能交付未验证源码。"}
            </strong>{" "}
            {status.reason}
          </p>
          <EnvironmentChecks status={status} />
          <p className="field-hint">
            环境检查通过表示可以尝试隔离验证；实际项目仍需构建、测试和人工验收。
          </p>
        </>
      )}
    </section>
  );
}
