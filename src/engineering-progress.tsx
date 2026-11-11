import { useState } from "react";

export type Pipeline = {
  revision: number;
  next: string | null;
  stages: {
    id: string;
    label: string;
    status: string;
    calls: number;
    allowance: number;
    error: string;
  }[];
  contract: {
    architecture: string;
    interfaces: string;
    dataModel: string;
  } | null;
  draftFiles: { path: string; bytes: number }[];
  events: {
    stage: string;
    call: number;
    status: string;
    at: string;
    usage?: { total: number };
    usageIncomplete?: boolean;
    error?: string;
  }[];
};
export type Acceptance = {
  complete: boolean;
  items: {
    id: string;
    criterion: string;
    source: string;
    recommendation: string;
    reason: string;
    files: { path: string; quote: string }[];
    checks: { index: number; name: string; passed: boolean; detail: string }[];
    decision: { actor: string; value: string; note: string; at: string } | null;
  }[];
};
export type Resume = {
  allowed: boolean;
  reason: string;
  revision: number;
  next: string;
  label: string;
  calls: number;
  remainingCalls: number;
  needsExtra: boolean;
  modelRequired: boolean;
};
const statuses: Record<string, string> = {
  pending: "等待",
  running: "执行中",
  completed: "已保存",
  failed: "未完成",
  skipped: "无需执行",
};
export function EngineeringProgress({
  pipeline,
  acceptance,
  canAccept,
  busy,
  onDecision,
}: {
  pipeline: Pipeline;
  acceptance?: Acceptance;
  canAccept: boolean;
  busy: boolean;
  onDecision: (
    id: string,
    value: "approved" | "rejected",
    note: string,
  ) => Promise<void>;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <section className="engineering-progress" aria-label="阶段与需求验收">
      <h4>阶段检查点</h4>
      <p className="software-note">
        阶段“已保存”表示产物已通过格式检查，不代表全部业务已验收。完成阶段不会因恢复而重跑。
      </p>
      <ol className="engineering-stages">
        {pipeline.stages.map((s) => (
          <li
            key={s.id}
            aria-current={pipeline.next === s.id ? "step" : undefined}
          >
            <div>
              <strong>{s.label}</strong>
              <span>{statuses[s.status]}</span>
            </div>
            <small>
              {s.id === "validation"
                ? "平台隔离验证 · 不调用模型"
                : `模型尝试 ${s.calls} / ${s.allowance}`}
            </small>
            {s.error && <p>{s.error}</p>}
          </li>
        ))}
      </ol>
      {!!pipeline.events.length && (
        <details className="software-logs">
          <summary>阶段调用与用量 · {pipeline.events.length} 次尝试</summary>
          {pipeline.events.map((event, i) => (
            <p key={i}>
              {pipeline.stages.find((s) => s.id === event.stage)?.label} · 第{" "}
              {event.call} 次 · {statuses[event.status]}
              {event.usage
                ? ` · 已报告 ${event.usage.total} tokens${event.usageIncomplete ? "（不完整）" : ""}`
                : " · 用量未返回"}
              {event.error && ` · ${event.error}`}
            </p>
          ))}
        </details>
      )}
      {pipeline.contract && (
        <details className="software-logs">
          <summary>已保存的接口与数据契约</summary>
          <h5>实现范围</h5>
          <pre>{pipeline.contract.architecture}</pre>
          <h5>接口</h5>
          <pre>{pipeline.contract.interfaces}</pre>
          <h5>数据</h5>
          <pre>{pipeline.contract.dataModel}</pre>
        </details>
      )}
      {acceptance && (
        <section aria-label="逐条需求验收" className="engineering-acceptance">
          <h4>
            逐条需求验收 ·{" "}
            {
              acceptance.items.filter((r) => r.decision?.value === "approved")
                .length
            }
            /{acceptance.items.length} 人工通过
          </h4>
          <p className="software-note">
            {acceptance.complete
              ? "此源码版本的全部条目已由你确认。"
              : "尚未完成全部人工验收。"}{" "}
            AI
            仅提出建议；检查项是否足以证明这条需求，仍需你判断。不会自动完成项目或任务。
          </p>
          {acceptance.items.map((r, i) => (
            <details key={r.id}>
              <summary>
                <span>
                  {i + 1}. {r.source}
                </span>
                <b>
                  {r.decision?.value === "approved"
                    ? "人工通过"
                    : r.decision?.value === "rejected"
                      ? "人工退回"
                      : "待人工验收"}
                </b>
              </summary>
              <p className="engineering-criterion">{r.criterion}</p>
              <p>
                AI 建议：
                {r.recommendation === "supported"
                  ? "有关联证据，待确认"
                  : r.recommendation === "missing"
                    ? "存在缺失"
                    : "需要人工判断"}
                。{r.reason}
              </p>
              {r.files.map((f, j) => (
                <blockquote key={j}>
                  <code>{f.path}</code>
                  <pre>{f.quote}</pre>
                </blockquote>
              ))}
              {r.checks.length ? (
                <ul>
                  {r.checks.map((c) => (
                    <li key={c.index}>
                      {c.name} · {c.passed ? "测试通过" : "测试失败"}：
                      {c.detail}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>没有关联的实际测试证据。</p>
              )}
              {r.decision && (
                <p>
                  人工记录：{r.decision.note} ·{" "}
                  {new Date(r.decision.at).toLocaleString("zh-CN")}
                </p>
              )}
              <label>
                验收依据或退回原因
                <textarea
                  aria-label={`验收意见 ${i + 1}`}
                  maxLength={2000}
                  value={notes[r.id] || ""}
                  disabled={!canAccept || busy}
                  onChange={(e) =>
                    setNotes({ ...notes, [r.id]: e.target.value })
                  }
                />
              </label>
              <div className="inline-controls">
                <button
                  className="button"
                  disabled={!canAccept || busy || !notes[r.id]?.trim()}
                  onClick={() => void onDecision(r.id, "approved", notes[r.id])}
                >
                  确认此项通过
                </button>
                <button
                  className="button"
                  disabled={!canAccept || busy || !notes[r.id]?.trim()}
                  onClick={() => void onDecision(r.id, "rejected", notes[r.id])}
                >
                  退回此项
                </button>
              </div>
            </details>
          ))}
        </section>
      )}
    </section>
  );
}
