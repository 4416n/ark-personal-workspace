import { useEffect, useRef, type ReactNode } from "react";
import {
  X,
  Bot,
  Code2,
  PenTool,
  Lightbulb,
  Palette,
  ArrowUpRight,
  Folder,
  CalendarDays,
  ChevronRight,
  Plus,
} from "lucide-react";
import { useApp } from "./context";
import { transitionError } from "../shared/task-policy.mjs";
import { resultPreview } from "../shared/deliverables.mjs";
import {
  dateLabel,
  projectProgress,
  priorityText,
  type Member,
  type Project,
  type Task,
} from "./domain";

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-icon ${small ? "small" : ""}`}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path
          d="m10 29 10-19 10 19M15 22h11"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="30" cy="9" r="2" fill="currentColor" />
      </svg>
    </span>
  );
}
export function Avatar({
  member,
  size = "",
  online = false,
}: {
  member?: Member;
  size?: "small" | "large" | "";
  online?: boolean;
}) {
  const Icon =
    member?.department === "研发部"
      ? Code2
      : member?.department === "设计部"
        ? Palette
        : member?.department === "内容部"
          ? PenTool
          : member?.department === "策略部"
            ? Lightbulb
            : Bot;
  return (
    <span
      className={`avatar ${member?.color || "purple"} ${size}`}
      title={member?.name || "未分配"}
    >
      <Icon
        size={size === "small" ? 15 : size === "large" ? 27 : 21}
        strokeWidth={1.7}
      />
      {online && <i className="online-dot" />}
    </span>
  );
}
export function Empty({
  icon = <Folder size={32} />,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function SectionHeading({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <h2>
        {title}
        {detail && <span>{detail}</span>}
      </h2>
      {action}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  wide = false,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key !== "Tab") return;
      const elements = [
        ...(ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],summary,[tabindex="0"]',
        ) || []),
      ].filter((el) => el.offsetParent !== null);
      if (!elements.length) {
        e.preventDefault();
        return;
      }
      if (
        e.shiftKey &&
        (document.activeElement === elements[0] ||
          document.activeElement === ref.current)
      ) {
        e.preventDefault();
        elements.at(-1)?.focus();
      }
      if (!e.shiftKey && document.activeElement === elements.at(-1)) {
        e.preventDefault();
        elements[0].focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <header className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function ProjectCard({ project }: { project: Project }) {
  const { state, open } = useApp();
  const tasks = state.tasks.filter((t) => t.projectId === project.id);
  const progress = projectProgress(project, state.tasks);
  const members = state.members.filter((m) =>
    tasks.some((t) => t.ownerId === m.id),
  );
  return (
    <button
      className="project-card"
      onClick={() => open({ type: "project", id: project.id })}
    >
      <div className="project-card-top">
        <span className={`project-icon ${project.color}`}>
          <Folder size={21} strokeWidth={1.7} />
        </span>
        <span
          className={`pill ${project.status === "done" ? "green" : project.status === "paused" ? "neutral" : "purple"}`}
        >
          {project.status === "done"
            ? "已完成"
            : project.status === "paused"
              ? "已暂停"
              : "进行中"}
        </span>
        <ArrowUpRight className="card-arrow" size={17} />
      </div>
      <h3>{project.title}</h3>
      <p>{project.goal}</p>
      <div className="progress-caption">
        <span>项目进度</span>
        <strong>
          {progress}
          <small>%</small>
        </strong>
      </div>
      <div className="progress-track">
        <span className={project.color} style={{ width: `${progress}%` }} />
      </div>
      <div className="project-card-bottom">
        <div className="avatar-stack">
          {members.slice(0, 3).map((m) => (
            <Avatar key={m.id} member={m} size="small" />
          ))}
          <small>
            {tasks.filter((t) => t.status === "done").length}/{tasks.length}{" "}
            任务
          </small>
        </div>
        <span>
          <CalendarDays size={12} />
          {dateLabel(project.deadline)}
        </span>
      </div>
      {project.demo && <span className="demo-corner">示例</span>}
    </button>
  );
}
export function TaskRow({ task }: { task: Task }) {
  const { state, open, update, notify } = useApp();
  const member = state.members.find((m) => m.id === task.ownerId);
  const project = state.projects.find((p) => p.id === task.projectId);
  return (
    <div className="task-row">
      <button
        className={`task-check ${task.status === "done" ? "checked" : ""}`}
        aria-label={`${task.status === "done" ? "重新打开" : "完成"}${task.title}`}
        onClick={() => {
          const error = transitionError(
            task,
            task.status === "done" ? "todo" : "done",
            state.tasks,
          );
          if (error) {
            notify(error, true);
            return;
          }
          update(
            (s) => ({
              ...s,
              tasks: s.tasks.map((t) =>
                t.id === task.id
                  ? { ...t, status: t.status === "done" ? "todo" : "done" }
                  : t,
              ),
            }),
            `${task.status === "done" ? "重新打开" : "完成任务"}：${task.title}`,
          );
          notify(
            task.status === "done"
              ? "任务已重新打开"
              : "任务已完成，继续前进！",
          );
        }}
      >
        {task.status === "done" ? "✓" : ""}
      </button>
      <button
        className="task-row-main"
        onClick={() => open({ type: "task", id: task.id })}
      >
        <strong>{task.title}</strong>
        {task.result.trim() && (
          <em className="result-preview">
            {resultPreview(task.result, 72) || "已写好交付正文"}
          </em>
        )}
        <span>
          {project?.title}
          {task.status === "review" && <b className="review-inline">待验收</b>}
        </span>
      </button>
      <span
        className={`priority-dot ${task.priority}`}
        title={priorityText[task.priority]}
      />
      <span className="task-date">{dateLabel(task.deadline)}</span>
      <Avatar member={member} size="small" />
      <button
        className="icon-button"
        aria-label={`查看${task.title}`}
        onClick={() => open({ type: "task", id: task.id })}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
export function AddProjectButton() {
  const { open } = useApp();
  return (
    <button
      className="button primary"
      onClick={() => open({ type: "project-new" })}
    >
      <Plus size={17} />
      新建项目
    </button>
  );
}
