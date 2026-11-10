import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Activity, Square, RotateCcw, Download, Clock3 } from "lucide-react";
import { api, download, useActiveCalls } from "./store";
import { useApp } from "./context";
import { PageHeading, Empty, Modal } from "./components";
import type { Passage } from "../shared/retrieval.mjs";
import { replaceResult } from "./delivery";
import { transitionError } from "../shared/task-policy.mjs";

export function CancelGeneration({ endpoint }: { endpoint: string }) {
  const calls = useActiveCalls().filter(([, path]) => path === endpoint);
  const { notify } = useApp();
  return (
    <>
      {calls.map(([id]) => (
        <button
          key={id}
          type="button"
          className="button small-button"
          onClick={async () => {
            try {
              const r = await api<{ cancelled: boolean }>(
                `/runs/${id}/cancel`,
                {},
              );
              notify(r.cancelled ? "正在取消生成" : "执行已结束，请等待结果");
            } catch (e) {
              notify((e as Error).message, true);
            }
          }}
        >
          <Square size={13} />
          取消生成
        </button>
      ))}
    </>
  );
}
export function GenerationProgress({ endpoint }: { endpoint: string }) {
  const id = useActiveCalls().find(([, path]) => path === endpoint)?.[0];
  const [progress, setProgress] = useState<{
    label: string;
    part: number;
    parts: number;
  }>();
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const tick = () =>
      api<{ progress?: { label: string; part: number; parts: number } }>(
        `/runs/${id}`,
      )
        .then((run) => {
          if (alive) setProgress(run.progress);
        })
        .catch(() => {});
    void tick();
    const timer = setInterval(tick, 800);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id]);
  if (!id) return null;
  const part = progress?.part || 1;
  const parts = Math.max(1, progress?.parts || 4);
  return (
    <div className="generation-progress" role="status">
      <span>{progress?.label || "正在生成，长文会自动分段续写"}</span>
      <div className="progress-track">
        <span style={{ width: `${Math.min(100, (part / parts) * 100)}%` }} />
      </div>
    </div>
  );
}
export function Sources({
  passages,
  canOpen,
}: {
  passages?: Passage[];
  canOpen?: () => boolean;
}) {
  const { state, open } = useApp();
  if (!passages?.length) return null;
  return (
    <details className="rag-sources">
      <summary>本次检索参考 · {passages.length} 个片段</summary>
      <p>以下是提供给模型的参考，不代表每段都被采用。请核对正文引用。</p>
      {passages.map((p) => (
        <article key={`${p.citation}-${p.start}`}>
          <header>
            <strong>
              [{p.citation}] {p.title}
            </strong>
            <small>
              字符 {p.start + 1}–{p.end}
            </small>
            {state.knowledge.some((k) => k.id === p.noteId) && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  if (!canOpen || canOpen())
                    open({ type: "knowledge", id: p.noteId });
                }}
              >
                打开原文
              </button>
            )}
          </header>
          <p>{p.content}</p>
        </article>
      ))}
    </details>
  );
}
type Run = {
  id: string;
  kind: string;
  label: string;
  model?: string;
  provider?: string;
  startedAt: string;
  finishedAt?: string;
  status: string;
  error?: string;
  usage?: { input: number; output: number; total: number } | null;
  sources: Passage[];
  endpoint: string;
  input?: Record<string, unknown>;
  output?: { content?: string; tasks?: unknown[] };
  hasOutput?: boolean;
};
const labels: Record<string, string> = {
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
export function RunsPage() {
  const { state, update, notify, open } = useApp();
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [retrying, setRetrying] = useState(false);
  const load = () =>
    api<Run[]>("/runs")
      .then((rows) => {
        setRuns(rows);
        setError("");
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, []);
  const detail = async (id: string) => {
    try {
      setSelected(await api<Run>(`/runs/${id}`));
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  const retry = async () => {
    if (
      !selected?.input ||
      retrying ||
      !["/execute", "/plan", "/chat", "/test"].includes(selected.endpoint)
    )
      return;
    setRetrying(true);
    try {
      const response = await api<{ runId: string }>(
        selected.endpoint,
        selected.input,
      );
      await load();
      await detail(response.runId);
      notify("重试已完成，成果保留在执行记录，请审核后使用");
    } catch (e) {
      notify((e as Error).message, true);
      await load();
    } finally {
      setRetrying(false);
    }
  };
  useEffect(() => {
    if (selected?.status !== "running") return;
    const timer = setInterval(() => {
      void api<Run>(`/runs/${selected.id}`)
        .then((r) =>
          setSelected((current) => (current?.id === r.id ? r : current)),
        )
        .catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [selected?.id, selected?.status]);
  const elapsed = (r: Run) =>
    `${Math.max(0, Math.round(((r.finishedAt ? Date.parse(r.finishedAt) : Date.now()) - Date.parse(r.startedAt)) / 1000))}s`;
  return (
    <>
      <PageHeading
        title="AI 执行记录"
        description="看清每次生成用了什么资料、花了多久，以及结果是否成功。"
        action={
          <button className="button" onClick={() => void load()}>
            刷新记录
          </button>
        }
      />
      <div className="run-overview">
        <div>
          <Activity size={20} />
          <strong>{runs.filter((r) => r.status === "running").length}</strong>
          <span>正在执行</span>
        </div>
        <div>
          <Clock3 size={20} />
          <strong>{runs.length}</strong>
          <span>最近执行</span>
        </div>
        <p>
          保留最近 100 次。Token
          来自服务商返回值，未返回时不估算；取消后仍可能产生已处理部分的费用。
        </p>
      </div>
      <div className="feature-tabs">
        {[
          ["all", "全部"],
          ["running", "执行中"],
          ["failed", "失败"],
          ["succeeded", "已完成"],
          ["cancelled", "已取消"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="run-list">
        {runs
          .filter((r) => filter === "all" || r.status === filter)
          .map((r) => (
            <article key={r.id}>
              <button className="run-main" onClick={() => void detail(r.id)}>
                <span
                  className={`pill ${r.status === "succeeded" ? "green" : r.status === "failed" ? "orange" : "neutral"}`}
                >
                  {labels[r.status]}
                </span>
                <div>
                  <h3>{r.label}</h3>
                  <p>
                    {r.model || "等待模型配置"} ·{" "}
                    {new Date(r.startedAt).toLocaleString("zh-CN")}
                  </p>
                  {r.error && <small>{r.error}</small>}
                </div>
                <span>
                  {elapsed(r)}
                  <small>
                    {r.usage ? `${r.usage.total} tokens` : "用量未返回"}
                  </small>
                </span>
              </button>
              {r.status === "running" && (
                <button
                  className="text-button danger"
                  onClick={async () => {
                    await api(`/runs/${r.id}/cancel`, {});
                    await load();
                  }}
                >
                  取消
                </button>
              )}
            </article>
          ))}
      </div>
      {!runs.length && (
        <Empty
          title="还没有 AI 执行记录"
          description="下次生成成果、智能拆解或发送对话时，会自动留下记录。"
        />
      )}
      {selected && (
        <Modal
          wide
          title="执行详情"
          subtitle={selected.label}
          onClose={() => {
            if (!retrying) setSelected(null);
          }}
        >
          <div className="modal-body">
            <div className="run-detail-meta">
              <span>{labels[selected.status]}</span>
              <span>{selected.model || "尚未连接模型"}</span>
              <span>{elapsed(selected)}</span>
            </div>
            <p className="field-hint">
              {selected.usage
                ? `输入 ${selected.usage.input} / 输出 ${selected.usage.output} / 合计 ${selected.usage.total} tokens`
                : "服务商未返回用量，不估算费用。"}
            </p>
            {selected.error && (
              <div className="alert error">{selected.error}</div>
            )}
            <Sources
              passages={selected.sources}
              canOpen={() => {
                setSelected(null);
                return true;
              }}
            />
            {selected.kind === "software-generate" && (
              <div className="alert">
                这里记录模型生成的文件清单，不是最终工程验收。构建、运行、自动修复结果和
                ZIP 请在项目「工程交付」查看。
              </div>
            )}
            {selected.output?.content &&
              selected.kind !== "software-generate" && (
                <div className="markdown run-output">
                  <ReactMarkdown>{selected.output.content}</ReactMarkdown>
                </div>
              )}
            {selected.output?.tasks && (
              <pre className="run-output">
                {JSON.stringify(selected.output.tasks, null, 2)}
              </pre>
            )}
            <p className="field-hint">
              {selected.kind === "software-generate"
                ? "模型调用成功不代表工程测试通过；源码在交付面板逐文件查看，原始模型输出可导出为 JSON。"
                : selected.kind.startsWith("auto-")
                  ? "自动执行记录包含本次要求、参考与结果；请在项目「自动执行」面板暂停或恢复流程。"
                  : "重试使用当时的要求与资料、当前模型配置；不会自动覆盖任务成果。"}
            </p>
          </div>
          <footer className="modal-footer">
            <div className="inline-controls">
              {selected.kind === "software-generate" && (
                <button
                  className="button"
                  onClick={() => {
                    const id = (
                      selected.input?.project as { id?: string } | undefined
                    )?.id;
                    if (!id || !state.projects.some((p) => p.id === id)) {
                      notify("原项目不存在，可导出原始结果", true);
                      return;
                    }
                    setSelected(null);
                    open({ type: "project", id, section: "software" });
                  }}
                >
                  查看工程交付
                </button>
              )}
              {selected.output && (
                <button
                  className="button"
                  onClick={() =>
                    download(
                      selected.kind === "software-generate"
                        ? "工程模型原始输出.json"
                        : "AI执行成果.md",
                      selected.output?.content ||
                        JSON.stringify(selected.output, null, 2),
                      selected.kind === "software-generate"
                        ? "application/json"
                        : "text/markdown",
                    )
                  }
                >
                  <Download size={14} />
                  导出结果
                </button>
              )}
              {selected.kind === "execute" && selected.output?.content && (
                <button
                  className="button"
                  onClick={() => {
                    const input = selected.input?.task as
                      { id?: string; title?: string } | undefined;
                    const target = state.tasks.find((t) => t.id === input?.id);
                    if (!target) {
                      notify("原任务不存在，可导出结果后手动录入", true);
                      return;
                    }
                    const policy = transitionError(
                      target,
                      "review",
                      state.tasks,
                    );
                    if (policy) {
                      notify(policy, true);
                      return;
                    }
                    if (
                      !confirm(
                        "将本次结果保存为原任务的待验收成果？当前成果将留存为历史版本。",
                      )
                    )
                      return;
                    update(
                      (s) => ({
                        ...s,
                        tasks: s.tasks.map((t) =>
                          t.id === target.id
                            ? {
                                ...replaceResult(
                                  t,
                                  selected.output!.content!,
                                  "ai",
                                  "ai",
                                ),
                                resultSources: selected.sources,
                              }
                            : t,
                        ),
                      }),
                      `从执行记录保存成果：${target.title}`,
                    );
                    notify("成果已提交待验收");
                  }}
                >
                  保存到原任务
                </button>
              )}
            </div>
            {selected.status !== "running" &&
              ["/execute", "/plan", "/chat", "/test"].includes(
                selected.endpoint,
              ) && (
                <button
                  className="button primary"
                  disabled={retrying}
                  onClick={() => void retry()}
                >
                  <RotateCcw size={14} />
                  {retrying ? "重试中…" : "重新执行"}
                </button>
              )}
            {retrying && <CancelGeneration endpoint={selected.endpoint} />}
          </footer>
        </Modal>
      )}
    </>
  );
}
