import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Download, FileCheck2, Play, Square } from "lucide-react";
import { useApp } from "./context";
import { api, download } from "./store";
import { statusText, type Task, type Project, type PlanItem } from "./domain";
import { taskContract, deliveryMarkdown } from "../shared/contract.mjs";
import { Sources } from "./runs-ui";

export function ContractFields({
  task,
  change,
  prefix = "",
}: {
  task: Pick<
    PlanItem,
    | "title"
    | "description"
    | "deliverable"
    | "acceptanceCriteria"
    | "executionMode"
  >;
  change: (
    patch: Pick<
      PlanItem,
      "deliverable" | "acceptanceCriteria" | "executionMode"
    >,
  ) => void;
  prefix?: string;
}) {
  const c = taskContract(task);
  const [criteria, setCriteria] = useState(
    (task.acceptanceCriteria || []).join("\n"),
  );
  return (
    <div className="contract-fields full">
      <label className="field">
        交付物名称与格式
        <input
          aria-label={`${prefix}交付物名称`}
          maxLength={300}
          value={task.deliverable || ""}
          placeholder={c.deliverable}
          onChange={(e) => change({ deliverable: e.target.value })}
        />
      </label>
      <label className="field">
        完成方式
        <select
          aria-label={`${prefix}完成方式`}
          value={task.executionMode || "ai"}
          onChange={(e) =>
            change({ executionMode: e.target.value as "ai" | "human" })
          }
        >
          <option value="ai">AI 文本 / 代码草稿</option>
          <option value="human">需要人工 / 外部操作</option>
        </select>
      </label>
      <label className="field full">
        验收清单（每行一条，最多 12 条）
        <textarea
          aria-label={`${prefix}验收清单`}
          rows={3}
          value={criteria}
          placeholder={c.acceptanceCriteria.join("\n")}
          onChange={(e) => {
            setCriteria(e.target.value);
            change({
              acceptanceCriteria: e.target.value
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean),
            });
          }}
        />
        <small>
          写清数量、范围、格式与必要证据。留空时沿用任务说明，不会凭空生成真实测试结果。
        </small>
      </label>
    </div>
  );
}

export function AiReviewSummary({ task }: { task: Task }) {
  const review = task.aiReview;
  if (!review || review.versionId !== task.resultMeta?.id) return null;
  return (
    <section className="ai-review-summary full">
      <h4>
        <FileCheck2 size={16} />
        AI 独立审查 · {review.passed ? "通过" : "未通过"}
      </h4>
      <p>{review.summary}</p>
      {review.requiresHuman && (
        <strong>需要人工核实或外部操作，不会自动完成。</strong>
      )}
      <ul>
        {review.checks.map((c, i) => (
          <li key={i}>
            <span>
              {c.passed ? "✓" : "!"} {c.criterion}
            </span>
            <p>{c.evidence}</p>
          </li>
        ))}
      </ul>
      <small>
        {review.model} · V{task.resultMeta?.number} · AI
        审查不等于人工验收或代码测试
      </small>
    </section>
  );
}
type Job = {
  id: string;
  status: string;
  phase: string;
  currentTaskId: string;
  note: string;
  usedCalls: number;
  maxCalls: number;
  maxReworks: number;
  mode: "auto" | "manual";
  taskIds: string[];
  events: { at: string; text: string }[];
  progress?: { part: number; parts: number; phase?: string } | null;
};
type Report = {
  job: Job | null;
  revision: number;
  project: Project | null;
  tasks: (Task & { automationBlock?: string })[];
};
const statuses: Record<string, string> = {
  running: "正在自动推进",
  pausing: "正在停止",
  paused: "已暂停",
  needs_attention: "需要你处理",
  completed: "本批交付已就绪",
};

export function AutomationPanel({ projectId }: { projectId: string }) {
  const { config, session, syncNow, open, notify } = useApp();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [maxCalls, setMaxCalls] = useState(30);
  const [maxReworks, setMaxReworks] = useState(1);
  const alive = useRef(true);
  const load = async () => {
    const next = await api<Report>(`/automation/${projectId}`);
    if (alive.current) setReport(next);
    return next;
  };
  useEffect(() => {
    alive.current = true;
    let pending = false;
    const poll = async (first = false) => {
      if (pending) return;
      pending = true;
      try {
        const r = await load();
        if (first && alive.current && r.job) {
          setMode(r.job.mode);
          setMaxCalls(r.job.maxCalls);
          setMaxReworks(r.job.maxReworks);
        }
      } catch (e) {
        if (alive.current) setError((e as Error).message);
      } finally {
        pending = false;
      }
    };
    if (session?.shared) void poll(true);
    const timer = setInterval(() => {
      if (session?.shared) void poll();
    }, 1500);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [projectId, session?.shared]);
  const job = report?.job;
  const active = job && ["running", "pausing"].includes(job.status);
  const start = async (resume = false) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await syncNow();
      const latest = await load();
      if (
        !confirm(
          `确认${resume ? "恢复" : "启动"}「${latest.project?.title}」的自动执行？\n\n${mode === "auto" ? "AI 审查通过后自动标记任务完成，并继续后续任务。" : "AI 审查后等待你人工验收，再恢复后续任务。"}\n本批总调用上限 ${maxCalls} 次（已用 ${resume ? latest.job?.usedCalls || 0 : 0} 次），每项最多返工 ${maxReworks} 次。生成、续写、审查、失败尝试均计入。将使用已配置模型并消耗实际额度；关闭页面仍会继续，电脑服务必须保持运行。`,
        )
      )
        return;
      await api(`/automation/${projectId}/${resume ? "resume" : "start"}`, {
        confirmed: true,
        revision: latest.revision,
        mode,
        maxCalls,
        maxReworks,
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  if (!session?.shared)
    return (
      <div className="alert">
        自动执行需要电脑共享数据库。请使用 npm start
        启动，不支持浏览器独立模式。
      </div>
    );
  const tasks = report?.tasks || [];
  return (
    <section
      className="automation-panel"
      aria-label="项目自动执行"
      data-live-project
    >
      <header className="automation-heading">
        <div>
          <h3>让计划走到交付</h3>
          <p>按依赖执行、独立审查、限次返工。这里查看真实进展和成果。</p>
        </div>
        <span
          className={`pill ${job?.status === "completed" ? "green" : "neutral"}`}
        >
          {job ? statuses[job.status] : "尚未启动"}
        </span>
      </header>
      <p className="automation-caveat">
        这里交付文档，不交付可运行网站。需要前后端与部署文件？
        <button
          className="text-button"
          onClick={() =>
            open({ type: "project", id: projectId, section: "software" })
          }
        >
          进入工程交付
        </button>
      </p>
      <ol className="automation-steps">
        <li>生成交付物</li>
        <li>逐项审查</li>
        <li>限次返工</li>
        <li>汇总交付</li>
      </ol>
      <details className="automation-policy" open={!job}>
        <summary>
          执行策略 · {mode === "auto" ? "AI 审查通过后继续" : "人工验收后继续"}{" "}
          · 上限 {maxCalls} 次
        </summary>
        <fieldset className="automation-settings" disabled={!!active || busy}>
          <label className="field">
            审查通过后
            <select
              aria-label="自动验收方式"
              value={mode}
              onChange={(e) => setMode(e.target.value as "auto" | "manual")}
            >
              <option value="auto">自动完成任务，继续下一步</option>
              <option value="manual">等待人工验收</option>
            </select>
          </label>
          <label className="field">
            本批总调用上限
            <input
              aria-label="自动执行调用上限"
              type="number"
              min={2}
              max={100}
              value={maxCalls}
              onChange={(e) => setMaxCalls(e.target.valueAsNumber)}
            />
          </label>
          <label className="field">
            每项最多返工
            <select
              aria-label="自动返工上限"
              value={maxReworks}
              onChange={(e) => setMaxReworks(Number(e.target.value))}
            >
              <option value={0}>不自动返工</option>
              <option value={1}>1 次</option>
              <option value={2}>2 次</option>
            </select>
          </label>
        </fieldset>
        <p className="automation-caveat">
          只自动交付文本 /
          代码草稿，不会运行代码、访问网站或替你发布。需要真实操作或资料不足时会停下来。AI
          审查使用同一已配置模型的独立请求，不是客观质量保证。
          {!config?.configured && " 请先在设置中连接 AI 模型。"}
        </p>
      </details>
      <div className="automation-controls">
        {active ? (
          <button
            className="button"
            disabled={busy || job?.status === "pausing"}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(`/automation/${projectId}/pause`, {});
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Square size={14} />
            {job?.status === "pausing" ? "正在停止…" : "暂停自动执行"}
          </button>
        ) : (
          <>
            {job && ["paused", "needs_attention"].includes(job.status) && (
              <button
                className="button primary"
                disabled={busy || !config?.configured}
                onClick={() => void start(true)}
              >
                <Play size={14} />
                确认并恢复执行
              </button>
            )}
            <button
              className={job ? "button" : "button primary"}
              disabled={
                busy ||
                !report ||
                !config?.configured ||
                !tasks.some((t) => t.status !== "done")
              }
              onClick={() => void start()}
            >
              <Play size={14} />
              {job ? "重新启动一批" : "启动自动执行"}
            </button>
          </>
        )}
        {report?.project && (
          <button
            className="button"
            onClick={() =>
              download(
                `${report.project!.title}—交付包.md`,
                deliveryMarkdown(report.project!, tasks),
                "text/markdown",
              )
            }
          >
            <Download size={14} />
            导出文档交付包
          </button>
        )}
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {job && (
        <div className="automation-status" role="status">
          <strong>{job.note}</strong>
          <span>
            调用尝试 {job.usedCalls}/{job.maxCalls} · 完成{" "}
            {tasks.filter((t) => t.status === "done").length}/{tasks.length}
          </span>
          {active && job.progress && (
            <small>
              {job.progress.phase === "review"
                ? "正在独立审查"
                : `正在撰写第 ${job.progress.part} 段，最多 ${job.progress.parts} 次调用；不代表完成百分比。`}
            </small>
          )}
          {active && (
            <small>
              关闭页面仍会继续。需要编辑项目时，请先暂停并等待停止；取消仍可能产生服务商已处理部分的费用。
            </small>
          )}
        </div>
      )}
      <div className="delivery-manifest">
        <h4>交付清单</h4>
        {!report && <p>正在读取电脑上的最新进展…</p>}
        {tasks.map((t) => {
          const c = taskContract(t);
          return (
            <details key={t.id} className="manifest-item">
              <summary>
                <FileCheck2 size={17} />
                <span>
                  <strong>{c.deliverable}</strong>
                  <small>
                    {t.title} ·{" "}
                    {active && job?.currentTaskId === t.id
                      ? job.phase === "review"
                        ? "正在独立审查"
                        : "正在生成交付物"
                      : statusText[t.status]}
                  </small>
                </span>
                {t.status === "done" && <Check size={17} />}
              </summary>
              <div className="manifest-body">
                <p>
                  <b>完成方式：</b>
                  {c.executionMode === "human"
                    ? "人工 / 外部操作"
                    : "AI 文本 / 代码草稿"}
                </p>
                <ul>
                  {c.acceptanceCriteria.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
                {t.automationBlock && (
                  <p className="manifest-block">{t.automationBlock}</p>
                )}
                <AiReviewSummary task={t} />
                {t.result ? (
                  <>
                    <h4>交付正文</h4>
                    <div className="markdown">
                      <ReactMarkdown>{t.result}</ReactMarkdown>
                    </div>
                    <Sources passages={t.resultSources} />
                  </>
                ) : (
                  <p className="muted">还没有交付正文；启动后在此查看。</p>
                )}
                <button
                  className="text-button"
                  disabled={!!active || busy}
                  onClick={async () => {
                    try {
                      await syncNow();
                      open({ type: "task", id: t.id });
                    } catch (e) {
                      notify((e as Error).message, true);
                    }
                  }}
                >
                  打开任务，人工调整或验收
                </button>
              </div>
            </details>
          );
        })}
      </div>
      {!!job?.events.length && (
        <details className="automation-events">
          <summary>执行过程 · {job.events.length} 条</summary>
          <ol>
            {job.events.map((e, i) => (
              <li key={i}>
                <time>{new Date(e.at).toLocaleTimeString("zh-CN")}</time>
                <span>{e.text}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

export function AutomationStrip() {
  const { session, open, notify } = useApp();
  const [jobs, setJobs] = useState<
    {
      projectId: string;
      title: string;
      note: string;
      status: string;
      kind?: string;
      id?: string;
      progress?: { part: number; parts: number } | null;
    }[]
  >([]);
  useEffect(() => {
    let alive = true,
      loading = false;
    const load = async () => {
      if (!session?.shared || loading) return;
      loading = true;
      try {
        const rows = await api<typeof jobs>("/automations");
        if (alive) setJobs(rows);
      } catch {
        /* Existing sync status reports connectivity. */
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session?.shared]);
  return (
    <>
      {jobs.map((j) => (
        <aside className="automation-strip" key={j.projectId}>
          <span>
            <strong>后台自动执行 · {j.title}</strong>
            <small>{j.note}</small>
          </span>
          <button
            className="text-button"
            onClick={() =>
              open({
                type: "project",
                id: j.projectId,
                section: j.kind === "software" ? "software" : "auto",
              })
            }
          >
            查看交付
          </button>
          <button
            className="text-button"
            disabled={["pausing", "cancelling"].includes(j.status)}
            onClick={async () => {
              try {
                await api(
                  j.kind === "software"
                    ? `/software-builds/${j.id}/cancel`
                    : `/automation/${j.projectId}/pause`,
                  {},
                );
                notify("已请求停止自动执行");
              } catch (e) {
                notify((e as Error).message, true);
              }
            }}
          >
            暂停
          </button>
        </aside>
      ))}
    </>
  );
}
