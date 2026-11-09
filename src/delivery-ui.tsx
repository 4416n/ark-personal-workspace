import { useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Archive,
  BookOpen,
  Check,
  Download,
  History,
  RotateCcw,
  GitCompareArrows,
} from "lucide-react";
import type { Project, ResultVersion, Task } from "./domain";
import { now, uid, knowledgeSchema } from "./domain";
import { versionReason } from "./delivery";
import {
  projectFacts,
  retrospectiveMarkdown,
  type RetroNotes,
} from "./retrospective";
import { useApp } from "./context";
import { download } from "./store";

const timeLabel = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function ReviewTrail({ task }: { task: Task }) {
  return (
    <div className="review-trail">
      {task.legacyReviewNote && (
        <p className="history-empty">
          旧版审批意见：{task.legacyReviewNote}（未记录时间与版本）
        </p>
      )}
      {!(task.reviews || []).length ? (
        <p className="history-empty">
          {task.reviewNote
            ? `旧版审批意见：${task.reviewNote}（未记录时间与版本）`
            : "还没有审批记录。验收通过或退回修改后，会在这里留下意见与对应版本。"}
        </p>
      ) : (
        task.reviews!.map((r) => (
          <article key={r.id} className={`review-event ${r.action}`}>
            <span className="review-event-mark">
              {r.action === "approved" ? (
                <Check size={13} />
              ) : (
                <RotateCcw size={13} />
              )}
            </span>
            <div>
              <header>
                <strong>
                  {r.action === "approved" ? "验收通过" : "退回修改"}
                </strong>
                <span>
                  {r.versionNumber ? `V${r.versionNumber}` : "无交付物版本"}
                </span>
                <time dateTime={r.at}>{timeLabel(r.at)}</time>
              </header>
              <p>{r.note}</p>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

export function DeliveryHistory({
  task,
  onRestore,
}: {
  task: Task;
  onRestore: (version: ResultVersion) => void;
}) {
  const [tab, setTab] = useState("versions");
  const [selected, setSelected] = useState("");
  const [compare, setCompare] = useState(false);
  const versions = task.resultHistory || [];
  const version = versions.find((v) => v.id === selected) || versions[0];
  return (
    <details className="delivery-history full">
      <summary>
        <History size={15} />
        <strong>成果与审批记录</strong>
        <span>
          {versions.length} 个历史版本 / {task.reviews?.length || 0} 条审批
        </span>
      </summary>
      <div className="history-body">
        <div className="history-tabs" aria-label="成果记录视图">
          <button
            type="button"
            aria-pressed={tab === "versions"}
            onClick={() => setTab("versions")}
          >
            版本记录
          </button>
          <button
            type="button"
            aria-pressed={tab === "reviews"}
            onClick={() => setTab("reviews")}
          >
            审批记录
          </button>
        </div>
        {tab === "reviews" ? (
          <ReviewTrail task={task} />
        ) : (
          <>
            <div className="version-current">
              <span className="pill green">
                当前{task.resultMeta ? ` V${task.resultMeta.number}` : "成果"}
              </span>
              <span>
                {task.resultMeta
                  ? versionReason[task.resultMeta.reason]
                  : "下次编辑时开始留存"}
              </span>
              <small>{task.result.length.toLocaleString()} 字符</small>
            </div>
            {!version ? (
              <p className="history-empty">
                保存修改或重新生成后，旧成果会保留在这里。恢复历史版本时，也会留下当前成果。
              </p>
            ) : (
              <>
                <label className="version-picker">
                  查看历史版本
                  <select
                    aria-label="查看历史版本"
                    value={version.id}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        V{v.number} · {versionReason[v.reason]} ·{" "}
                        {timeLabel(v.at)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="version-toolbar">
                  <span>
                    {version.content.length.toLocaleString()} 字符
                    {version.restoredFrom
                      ? ` · 恢复自 V${version.restoredFrom}`
                      : ""}
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    aria-pressed={compare}
                    onClick={() => setCompare(!compare)}
                  >
                    <GitCompareArrows size={14} />
                    {compare ? "收起对照" : "对照当前"}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      download(
                        `${task.title}-V${version.number}.md`,
                        version.content,
                        "text/markdown",
                      )
                    }
                  >
                    <Download size={14} />
                    导出此版
                  </button>
                </div>
                <div
                  className={`version-preview ${compare ? "comparing" : ""}`}
                >
                  <section>
                    <h4>历史 V{version.number}</h4>
                    <div className="markdown">
                      <ReactMarkdown>{version.content}</ReactMarkdown>
                    </div>
                  </section>
                  {compare && (
                    <section>
                      <h4>
                        当前成果
                        {task.resultMeta ? ` V${task.resultMeta.number}` : ""}
                      </h4>
                      <div className="markdown">
                        <ReactMarkdown>
                          {task.result || "暂无内容"}
                        </ReactMarkdown>
                      </div>
                    </section>
                  )}
                </div>
                <div className="version-restore">
                  <small>恢复后需重新验收；点击「保存任务」后生效。</small>
                  <button
                    type="button"
                    className="button small-button"
                    onClick={() => onRestore(version)}
                  >
                    <RotateCcw size={14} />
                    恢复为待验收
                  </button>
                </div>
              </>
            )}
          </>
        )}
        <p className="history-retention">
          每项任务最多保留 12 个历史版本、50
          条审批；达到存储上限时清理最早记录。重要成果请导出备份。
        </p>
      </div>
    </details>
  );
}

export function ProjectRetrospective({
  project,
  tasks,
  notes,
  onChange,
}: {
  project: Project;
  tasks: Task[];
  notes: RetroNotes;
  onChange: (notes: RetroNotes) => void;
}) {
  const { state, update, notify } = useApp();
  const [preview, setPreview] = useState(false);
  const f = projectFacts(tasks);
  const report = () =>
    retrospectiveMarkdown(project, tasks, state.members, notes);
  const save = (toKnowledge = false) => {
    const existing = state.knowledge.find(
      (k) => k.id === project.retrospective?.knowledgeId,
    );
    if (toKnowledge && !existing && state.knowledge.length >= 2000) {
      notify("知识库已满，请先整理笔记或导出复盘", true);
      return;
    }
    const updatedAt = now();
    const knowledgeId = toKnowledge
      ? existing?.id || uid()
      : project.retrospective?.knowledgeId;
    const note = {
      id: knowledgeId || uid(),
      title: `${project.title} · 项目复盘`,
      content: report(),
      category: "复盘" as const,
      updatedAt,
    };
    if (toKnowledge && !knowledgeSchema.safeParse(note).success) {
      notify("复盘内容过长，请缩短经验记录后重试", true);
      return;
    }
    update(
      (s) => ({
        ...s,
        projects: s.projects.map((p) =>
          p.id === project.id
            ? {
                ...p,
                retrospective: {
                  ...notes,
                  updatedAt,
                  ...(knowledgeId ? { knowledgeId } : {}),
                },
              }
            : p,
        ),
        knowledge: toKnowledge
          ? existing
            ? s.knowledge.map((k) => (k.id === existing.id ? note : k))
            : [note, ...s.knowledge]
          : s.knowledge,
      }),
      `${toKnowledge ? "沉淀项目复盘到知识库" : "保存项目复盘"}：${project.title}`,
    );
    notify(
      toKnowledge
        ? existing
          ? "知识库中的复盘已更新"
          : "复盘已保存到知识库"
        : "复盘笔记已保存",
    );
  };
  return (
    <section className="project-retrospective">
      <div className="retro-heading">
        <Archive size={19} />
        <div>
          <h3>把这次协作，变成下一次的经验</h3>
          <p>
            {project.status === "done" ? "结项复盘" : "阶段复盘"} ·
            汇总当前记录，无需连接模型
          </p>
        </div>
      </div>
      <div className="retro-facts">
        <div>
          <strong>
            {f.done}
            <small>/{f.total}</small>
          </strong>
          <span>任务完成</span>
        </div>
        <div>
          <strong>{f.delivered}</strong>
          <span>已有交付物</span>
        </div>
        <div>
          <strong>{f.returned}</strong>
          <span>留存返工记录</span>
        </div>
        <div>
          <strong>
            {f.hours}
            <small>h</small>
          </strong>
          <span>计划工时</span>
        </div>
      </div>
      <p className="retro-caption">
        数据来自当前任务；计划工时不是实际耗时。达成情况由你对照验收标准填写。
      </p>
      <div className="retro-fields">
        {(
          [
            [
              "outcome",
              "实际达成情况",
              "对照目标与验收标准：完成了什么？还有什么差距？",
            ],
            [
              "lessons",
              "可复用经验",
              "哪些分工、提示词或工作方法有效？下次如何减少返工？",
            ],
            [
              "nextSteps",
              "下一步行动",
              "下一次要保留、改进或继续验证的具体行动。",
            ],
          ] as const
        ).map(([key, title, placeholder]) => (
          <label className="field" key={key}>
            {title}
            <textarea
              rows={3}
              maxLength={5000}
              value={notes[key]}
              placeholder={placeholder}
              onChange={(e) => onChange({ ...notes, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="retro-actions">
        <small>
          {project.retrospective
            ? `上次保存 ${timeLabel(project.retrospective.updatedAt)}`
            : "笔记尚未保存"}
        </small>
        <button className="button small-button" onClick={() => save()}>
          保存复盘
        </button>
        <button
          className="button primary small-button"
          onClick={() => save(true)}
        >
          <BookOpen size={14} />
          {state.knowledge.some(
            (k) => k.id === project.retrospective?.knowledgeId,
          )
            ? "更新知识库复盘"
            : "沉淀到知识库"}
        </button>
      </div>
      <div className="retro-report-actions">
        <button className="text-button" onClick={() => setPreview(!preview)}>
          {preview ? "收起复盘预览" : "预览完整复盘"}
        </button>
        <button
          className="text-button"
          onClick={() =>
            download(`${project.title}-复盘.md`, report(), "text/markdown")
          }
        >
          <Download size={14} />
          导出复盘
        </button>
      </div>
      {preview && (
        <div className="markdown retro-preview">
          <ReactMarkdown>{report()}</ReactMarkdown>
        </div>
      )}
    </section>
  );
}
