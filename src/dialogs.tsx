import { useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Plus,
  LoaderCircle,
  Trash2,
  Check,
  Download,
  FileText,
  Folder,
  CalendarDays,
  CircleAlert,
  GitBranch,
  ListTodo,
  NotebookPen,
  Play,
} from "lucide-react";
import { useApp, type DialogState } from "./context";
import { Avatar, Modal, TaskRow, Empty } from "./components";
import {
  dateIn,
  dateLabel,
  now,
  uid,
  taskSchema,
  memberSchema,
  projectSchema,
  priorityText,
  statusText,
  projectProgress,
  type Knowledge,
  type Member,
  type PlanItem,
  type Priority,
  type Task,
  type Project,
} from "./domain";
import { api, download, downloadBytes } from "./store";
import {
  prepareTaskDraft,
  replaceResult,
  restoreResult,
  recordReview,
  boundWorkspaceHistory,
} from "./delivery";
import { DeliveryHistory, ProjectRetrospective } from "./delivery-ui";
import { emptyRetro, type RetroNotes } from "./retrospective";
import { projectToTemplate } from "./templates";
import { CancelGeneration, Sources } from "./runs-ui";
import {
  AutomationPanel,
  ContractFields,
  AiReviewSummary,
} from "./automation-ui";
import { deliveryMarkdown } from "../shared/contract.mjs";
import {
  deliverableFiles,
  resultPreview,
  safeFileName,
  zipStore,
} from "../shared/deliverables.mjs";
import type { Passage } from "../shared/retrieval.mjs";
import { DepartmentDetail } from "./organization";
import { AllocationReview } from "./planning";
import {
  allocationWarnings,
  pendingDependencies,
  departmentNames,
} from "./insights";
import { dependencyError, transitionError } from "../shared/task-policy.mjs";
import { taskReadiness } from "../shared/execution.mjs";
import {
  DependencyEditor,
  ProjectRoute,
  ReadinessBadge,
  StaffDesk,
} from "./execution";

export function Dialogs({
  dialog,
  close,
}: {
  dialog: NonNullable<DialogState>;
  close: () => void;
}) {
  switch (dialog.type) {
    case "project-new":
      return <NewProject close={close} initialGoal={dialog.goal} />;
    case "staff-work":
      return <StaffDesk key={dialog.id} id={dialog.id} close={close} />;
    case "department":
      return <DepartmentDetail name={dialog.name} close={close} />;
    case "project":
      return (
        <ProjectDetail
          key={`${dialog.id}-${dialog.section || "list"}`}
          id={dialog.id}
          close={close}
          section={dialog.section}
        />
      );
    case "task":
      return (
        <TaskDetail
          key={dialog.id || "new-task"}
          id={dialog.id}
          projectId={dialog.projectId}
          close={close}
        />
      );
    case "member":
      return (
        <MemberDetail
          key={dialog.id || "new-member"}
          id={dialog.id}
          close={close}
        />
      );
    case "knowledge":
      return (
        <KnowledgeDetail
          key={dialog.id || "new-note"}
          id={dialog.id}
          close={close}
        />
      );
  }
}
import { FileCode2 } from "lucide-react";
import { SoftwarePanel, softwareConfirmation } from "./software-ui";

type ProjectTaskView =
  | "software"
  | "auto"
  | "list"
  | "route"
  | "retro"
  | "catalog";

function DeliverableIndex({
  tasks,
  members,
  onOpen,
}: {
  tasks: Task[];
  members: Member[];
  onOpen: (id: string) => void;
}) {
  const ready = tasks.filter((task) => task.result.trim());
  if (!ready.length)
    return (
      <Empty
        title="还没有成果正文"
        description="任务写完交付后，全文会按条目列在这里，也可以从底部打包导出。"
      />
    );
  return (
    <div className="deliverable-index">
      {ready.map((task) => (
        <button
          key={task.id}
          className="deliverable-item"
          onClick={() => onOpen(task.id)}
        >
          <FileText size={16} />
          <span>
            <strong>{task.title}</strong>
            <small>
              {members.find((member) => member.id === task.ownerId)?.name ||
                "未分配"}
              {" · "}
              {resultPreview(task.result, 140) || "已写好交付正文"}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}

function NewProject({
  close,
  initialGoal = "",
}: {
  close: () => void;
  initialGoal?: string;
}) {
  const { state, update, config, notify, navigate, open, syncNow, session } =
    useApp();
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState(initialGoal.slice(0, 100));
  const [goal, setGoal] = useState(initialGoal);
  const [successCriteria, setSuccessCriteria] = useState("");
  const [budget, setBudget] = useState(0);
  const [deadline, setDeadline] = useState(dateIn(14));
  const [priority, setPriority] = useState<Priority>("medium");
  const [mode, setMode] = useState<"local" | "ai">("local");
  const deliveryChosen = useRef(false);
  const [deliveryType, setDeliveryType] = useState<"software" | "document">(
    /网站|网页|前端|后端|web|应用|系统|软件/i.test(initialGoal)
      ? "software"
      : "document",
  );
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [error, setError] = useState("");
  const generate = async () => {
    if (!title.trim() || goal.trim().length < 4) {
      setError("请填写项目名称和至少 4 个字的具体目标");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api<{ tasks: PlanItem[] }>("/plan", {
        goal: `${title}\n${goal}\n交付形式：${deliveryType === "software" ? "可运行网站，React前端、Express后端、SQLite数据库与Docker部署文件；任务必须围绕实际功能与可测试验收，而不是只写方案文档" : "文档成果"}\n验收标准：${successCriteria || "请结合目标给出具体标准"}\n预算：${budget ? `${budget}元` : "未设置"}`,
        mode,
        members: state.members,
        tasks: state.tasks.map(({ ownerId, status, estimatedHours }) => ({
          ownerId,
          status,
          estimatedHours,
        })),
        knowledge: state.knowledge,
      });
      setPlan(data.tasks);
      setStep(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const change = (index: number, patch: Partial<PlanItem>) =>
    setPlan((p) =>
      p.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  const save = async (auto = false) => {
    if (busy) return;
    if (
      !plan.length ||
      plan.some(
        (p) =>
          !p.title.trim() ||
          p.title.length > 200 ||
          !Number.isFinite(p.estimatedHours) ||
          p.estimatedHours < 0.5 ||
          p.estimatedHours > 80,
      )
    ) {
      setError("请补全任务标题与有效预估工时（0.5–80 小时）");
      return;
    }
    if (!Number.isFinite(budget) || budget < 0 || budget > 100000000) {
      setError("请填写有效预算");
      return;
    }
    if (
      allocationWarnings(plan, state).length &&
      !window.confirm("部分员工暂停接单或超出计划容量。确认保留当前分工？")
    )
      return;
    const projectId = uid();
    const createdAt = now();
    const project: Project = {
      id: projectId,
      title: title.trim(),
      goal: goal.trim(),
      deliveryType,
      deadline,
      priority,
      status: "active",
      color: "purple",
      createdAt,
      demo: false,
      successCriteria: successCriteria.trim(),
      budget,
    };
    const taskIds = plan.map(() => uid());
    const tasks: Task[] = plan.map((item, index) => ({
      id: taskIds[index],
      projectId,
      skills: item.skills,
      dependsOn: (item.dependsOn || [])
        .filter((n) => n < index)
        .map((n) => taskIds[n]),
      title: item.title.trim(),
      description: item.description,
      deliverable: item.deliverable,
      acceptanceCriteria: item.acceptanceCriteria,
      executionMode: item.executionMode,
      ownerId: item.ownerId,
      status: "todo",
      priority: item.priority,
      deadline,
      estimatedHours: item.estimatedHours,
      result: "",
      source: mode,
      createdAt,
      demo: false,
    }));
    if (
      !projectSchema.safeParse(project).success ||
      tasks.some((t) => !taskSchema.safeParse(t).success)
    ) {
      setError(
        "请检查交付清单：每项最多 12 条标准，每条不超过 1000 字，并补全有效项目日期与任务内容",
      );
      return;
    }
    if (
      state.projects.length >= 2000 ||
      state.tasks.length + tasks.length > 10000
    ) {
      setError("项目或任务数量已达上限");
      return;
    }
    if (auto && (!session?.shared || !config?.configured)) {
      setError("请先使用电脑共享模式并配置 AI 模型");
      return;
    }
    if (
      auto &&
      !confirm(
        deliveryType === "software"
          ? softwareConfirmation(title, 1)
          : "创建后立即自动执行这份计划？\n\n将使用你配置的模型，按依赖生成成果、独立审查；通过则自动完成任务并继续。每项最多返工 1 次，本批总调用上限 30 次。生成、审查及失败尝试均计入，可能产生费用。\n\n需要真实外部操作的任务会停下，不会发布或运行代码。关闭页面仍会继续，服务停止则暂停。可在项目中随时暂停。",
      )
    )
      return;
    update(
      (s) => ({
        ...s,
        projects: [project, ...s.projects],
        tasks: [...tasks, ...s.tasks],
      }),
      `创建项目「${title.trim()}」，规划 ${tasks.length} 个任务`,
    );
    if (auto) {
      setBusy(true);
      try {
        const revision = await syncNow();
        if (deliveryType === "software")
          await api(`/software/${projectId}/start`, {
            confirmed: true,
            allowSandbox: true,
            revision,
            maxRepairs: 1,
          });
        else
          await api(`/automation/${projectId}/start`, {
            confirmed: true,
            revision,
            mode: "auto",
            maxCalls: 30,
            maxReworks: 1,
          });
        notify(
          deliveryType === "software"
            ? "项目已创建，正在后台生成、测试与打包工程"
            : "项目已创建，正在后台生成与审查交付物",
        );
      } catch (e) {
        notify(`项目已创建，但自动启动未成功：${(e as Error).message}`, true);
      } finally {
        setBusy(false);
      }
      close();
      navigate("projects");
      open({
        type: "project",
        id: projectId,
        section: deliveryType === "software" ? "software" : "auto",
      });
      return;
    }
    notify(
      deliveryType === "software"
        ? "项目已创建，在「工程交付」生成完整网站"
        : `项目已创建，${tasks.length} 个任务已加入看板；进入项目「自动执行」可连续生成与审查`,
    );
    close();
    navigate("projects");
    if (deliveryType === "software")
      open({ type: "project", id: projectId, section: "software" });
  };
  return (
    <Modal
      wide
      title={step === 1 ? "从一个新目标开始" : "让合适的伙伴，各展所长"}
      subtitle={
        step === 1
          ? "写下想实现的事，剩下的我们一起梳理。"
          : "确认交付物、验收清单与分工。只创建计划，或确认后立即自动执行。"
      }
      onClose={() => {
        if (!busy) close();
      }}
    >
      <div className="step-indicator">
        <span className="active">
          <b>{step === 2 ? <Check size={12} /> : "1"}</b>定义目标
        </span>
        <i />
        <span className={step === 2 ? "active" : ""}>
          <b>2</b>确认计划
        </span>
      </div>
      {step === 1 ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void generate();
          }}
        >
          <div className="modal-body form-grid">
            <label className="field full">
              项目名称
              <input
                required
                maxLength={100}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!deliveryChosen.current)
                    setDeliveryType(
                      /网站|网页|前端|后端|web|应用|系统|软件/i.test(
                        e.target.value + " " + goal,
                      )
                        ? "software"
                        : "document",
                    );
                }}
                placeholder="例如：30 天打造我的个人知识库"
              />
            </label>
            <label className="field full">
              我想实现的目标
              <textarea
                required
                minLength={4}
                maxLength={10000}
                rows={4}
                value={goal}
                onChange={(e) => {
                  setGoal(e.target.value);
                  if (!deliveryChosen.current)
                    setDeliveryType(
                      /网站|网页|前端|后端|web|应用|系统|软件/i.test(
                        title + " " + e.target.value,
                      )
                        ? "software"
                        : "document",
                    );
                }}
                placeholder="希望达到什么结果？有哪些时间、资源或风格要求？越具体，规划越有帮助。"
              />
            </label>
            <label className="field full">
              交付形式
              <select
                aria-label="交付形式"
                value={deliveryType}
                onChange={(e) => {
                  deliveryChosen.current = true;
                  setDeliveryType(e.target.value as "software" | "document");
                }}
              >
                <option value="software">
                  完整网站工程：前端 + 后端 + 数据库 + 部署文件
                </option>
                <option value="document">
                  文档成果：方案 / 内容 / 研究资料
                </option>
              </select>
              <small>
                {deliveryType === "software"
                  ? "按完整工程生成、隔离构建测试、失败自动修复；交付可下载源码，不是 Markdown。首版支持 React + Express + SQLite，不含实际上线。"
                  : "生成正文、AI 审查与交付包；软件项目请选择完整网站工程。"}
              </small>
            </label>
            <label className="field">
              计划完成日期
              <input
                required
                type="date"
                min={dateIn()}
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </label>
            <label className="field">
              项目优先级
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
              >
                {Object.entries(priorityText).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="field full">
              项目验收标准
              <textarea
                rows={2}
                maxLength={3000}
                value={successCriteria}
                onChange={(e) => setSuccessCriteria(e.target.value)}
                placeholder="例如：可访问的作品主页、至少 3 个项目案例、10 位用户的真实反馈"
              />
            </label>
            <label className="field full">
              项目计划预算（元）
              <input
                required
                type="number"
                min="0"
                max="100000000"
                value={budget}
                onChange={(e) => setBudget(e.target.valueAsNumber)}
              />
              <small>0 表示暂未设定；作为 AI 规划约束，不代表实际花费。</small>
            </label>
            <div className="field full">
              选择规划方式
              <div className="mode-options">
                <button
                  type="button"
                  className={mode === "local" ? "selected" : ""}
                  onClick={() => setMode("local")}
                >
                  <Folder size={21} />
                  <strong>
                    离线规划<span>开箱即用</span>
                  </strong>
                  <p>按目标类型生成基础步骤，并根据技能和负载匹配员工。</p>
                </button>
                <button
                  type="button"
                  className={mode === "ai" ? "selected" : ""}
                  disabled={!config?.configured}
                  onClick={() => setMode("ai")}
                >
                  <Sparkles size={21} />
                  <strong>
                    AI 智能拆解
                    <span>
                      {config?.configured ? "模型已配置" : "需配置 API"}
                    </span>
                  </strong>
                  <p>结合你的目标与知识资料，生成更有针对性的执行方案。</p>
                </button>
              </div>
              <small>
                离线规划使用预设规则；AI
                拆解会将目标、员工技能和知识资料发送至已配置的模型。
              </small>
            </div>
            {error && (
              <div className="alert error full">
                <CircleAlert size={16} />
                {error}
              </div>
            )}
          </div>
          <footer className="modal-footer">
            {busy && <CancelGeneration endpoint="/plan" />}
            <span>{state.members.length} 位伙伴可参与协作</span>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Sparkles size={16} />
              )}{" "}
              {busy ? "正在梳理你的目标..." : "生成执行计划"}
              {!busy && <ArrowRight size={16} />}
            </button>
          </footer>
        </form>
      ) : (
        <>
          <div className="modal-body plan-body">
            <div className="plan-summary">
              <span className="project-icon purple">
                <Folder size={23} />
              </span>
              <div>
                <strong>{title}</strong>
                <span>
                  {dateLabel(deadline)}前完成 · {plan.length} 个任务 · 预计{" "}
                  {plan.reduce((s, t) => s + t.estimatedHours, 0)} 小时
                </span>
              </div>
              <span className="pill purple">
                {mode === "ai" ? "AI 生成" : "离线规划"}
              </span>
            </div>
            <AllocationReview
              plan={plan}
              change={change}
              remove={(index) =>
                setPlan((items) =>
                  items
                    .filter((_, i) => i !== index)
                    .map((item) => ({
                      ...item,
                      dependsOn: (item.dependsOn || [])
                        .filter((n) => n !== index)
                        .map((n) => (n > index ? n - 1 : n)),
                    })),
                )
              }
            />
            <button
              className="text-button"
              onClick={() =>
                setPlan((p) => [
                  ...p,
                  {
                    title: "",
                    description: "",
                    ownerId: "",
                    priority: "medium",
                    estimatedHours: 2,
                    reason: "手动添加",
                    skills: [],
                  },
                ])
              }
            >
              <Plus size={16} />
              补充一个任务
            </button>
            {error && <div className="alert error">{error}</div>}
          </div>
          <footer className="modal-footer">
            <button
              className="text-button muted"
              onClick={() => {
                setStep(1);
                setError("");
              }}
            >
              <ArrowLeft size={15} />
              调整目标
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void save()}
            >
              <Check size={16} />
              确认计划，开始推进
            </button>
            {session?.shared && config?.configured && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void save(true)}
              >
                <Play size={16} />
                {busy
                  ? "正在启动…"
                  : deliveryType === "software"
                    ? "创建并交付工程"
                    : "创建并自动执行"}
              </button>
            )}
          </footer>
        </>
      )}
    </Modal>
  );
}

function ProjectDetail({
  id,
  close,
  section,
}: {
  id: string;
  close: () => void;
  section?: "auto" | "software";
}) {
  const { state, update, open, notify } = useApp();
  const p = state.projects.find((p) => p.id === id);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(p?.title || "");
  const [goal, setGoal] = useState(p?.goal || "");
  const [deadline, setDeadline] = useState(p?.deadline || dateIn(14));
  const [successCriteria, setSuccessCriteria] = useState(
    p?.successCriteria || "",
  );
  const [budget, setBudget] = useState(p?.budget || 0);
  const [taskView, setTaskView] = useState<ProjectTaskView>(
    section || (p?.deliveryType === "software" ? "software" : "list"),
  );
  const [retroNotes, setRetroNotes] = useState<RetroNotes>(() => ({
    outcome: p?.retrospective?.outcome || "",
    lessons: p?.retrospective?.lessons || "",
    nextSteps: p?.retrospective?.nextSteps || "",
  }));
  if (!p) return null;
  const retroDirty = (Object.keys(emptyRetro) as (keyof RetroNotes)[]).some(
    (key) => retroNotes[key] !== (p.retrospective?.[key] || ""),
  );
  const canLeaveProject = () =>
    !retroDirty || window.confirm("复盘有未保存的笔记，确定放弃并离开？");
  const selectTaskView = (view: ProjectTaskView) => {
    if (taskView === "retro" && view !== "retro" && retroDirty) {
      if (!window.confirm("复盘笔记尚未保存，放弃修改并切换视图？")) return;
      setRetroNotes({
        outcome: p.retrospective?.outcome || "",
        lessons: p.retrospective?.lessons || "",
        nextSteps: p.retrospective?.nextSteps || "",
      });
    }
    setTaskView(view);
  };
  const tasks = state.tasks.filter((t) => t.projectId === id);
  const progress = projectProgress(p, tasks);
  const readyToClose =
    tasks.length > 0 &&
    tasks.every((task) => task.status === "done") &&
    p.status !== "done";
  const exportDocument = () =>
    download(
      `${safeFileName(p.title)}.md`,
      deliveryMarkdown(p, tasks),
      "text/markdown",
    );
  const exportZip = () =>
    downloadBytes(
      `${safeFileName(p.title)}-成果.zip`,
      zipStore(deliverableFiles(p, tasks, state.members)),
      "application/zip",
    );
  const changeStatus = (status: Project["status"]) => {
    if (
      status === "done" &&
      tasks.some((t) => t.status !== "done") &&
      !window.confirm("仍有未完成任务。将项目和全部任务一起标记完成？")
    )
      return;
    update(
      (s) => ({
        ...s,
        projects: s.projects.map((p) => (p.id === id ? { ...p, status } : p)),
        tasks:
          status === "done"
            ? s.tasks.map((t) =>
                t.projectId === id ? { ...t, status: "done" } : t,
              )
            : s.tasks,
      }),
      `更新项目「${p.title}」状态`,
    );
    notify("项目状态已更新");
  };
  return (
    <Modal
      wide
      title={p.title}
      subtitle={
        p.demo
          ? "示例项目 · 你可以自由编辑，或在设置中清除示例"
          : "项目空间 · 掌握目标与每一步进展"
      }
      onClose={() => {
        if (canLeaveProject()) close();
      }}
    >
      <div className="modal-body">
        <div className="project-detail-meta">
          <span className={`pill ${p.color}`}>{priorityText[p.priority]}</span>
          <span>
            <CalendarDays size={15} />
            {dateLabel(p.deadline)}前完成
          </span>
          <select
            aria-label="项目状态"
            value={p.status}
            onChange={(e) => changeStatus(e.target.value as Project["status"])}
          >
            <option value="active">进行中</option>
            <option value="paused">已暂停</option>
            <option value="done">已完成</option>
          </select>
        </div>
        {editing ? (
          <form
            className="project-edit-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                !projectSchema.safeParse({
                  ...p,
                  title: title.trim(),
                  goal: goal.trim(),
                  deadline,
                  successCriteria,
                  budget,
                }).success
              ) {
                notify("请检查项目名称、目标、日期和预算", true);
                return;
              }
              update(
                (s) => ({
                  ...s,
                  projects: s.projects.map((p) =>
                    p.id === id
                      ? {
                          ...p,
                          title: title.trim(),
                          goal: goal.trim(),
                          deadline,
                          successCriteria: successCriteria.trim(),
                          budget,
                        }
                      : p,
                  ),
                }),
                `编辑项目「${title.trim()}」`,
              );
              setEditing(false);
              notify("项目已保存");
            }}
          >
            <label className="field">
              名称
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={100}
              />
            </label>
            <label className="field">
              目标
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                required
                maxLength={10000}
              />
            </label>
            <label className="field">
              截止日期
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                required
              />
            </label>
            <label className="field">
              验收标准
              <textarea
                rows={3}
                maxLength={3000}
                value={successCriteria}
                onChange={(e) => setSuccessCriteria(e.target.value)}
                placeholder="用什么结果判断目标达成？"
              />
            </label>
            <label className="field">
              计划预算（元）
              <input
                type="number"
                min="0"
                max="100000000"
                required
                value={budget}
                onChange={(e) => setBudget(e.target.valueAsNumber)}
              />
            </label>
            <button className="button primary" type="submit">
              保存项目
            </button>
          </form>
        ) : (
          <div className="project-goal">
            <h4>
              项目目标
              <button className="text-button" onClick={() => setEditing(true)}>
                编辑
              </button>
            </h4>
            <p>{p.goal}</p>
            {p.successCriteria && (
              <div className="project-criteria">
                <strong>验收标准</strong>
                <p>{p.successCriteria}</p>
              </div>
            )}
            <small>
              计划预算 ¥{(p.budget || 0).toLocaleString()} · 非实际支出
            </small>
          </div>
        )}
        <div className="detail-progress">
          <span>
            总体进度 · {tasks.filter((t) => t.status === "done").length}/
            {tasks.length} 个任务完成
          </span>
          <strong>{progress}%</strong>
          <div className="progress-track">
            <span className={p.color} style={{ width: `${progress}%` }} />
          </div>
        </div>
        {readyToClose && (
          <div className="closeout-banner" role="status">
            <div>
              <strong>全部任务已完成</strong>
              <p>
                成果已经写在任务里。可以先复盘、导出，再把项目标为完成。
              </p>
            </div>
            <div className="closeout-actions">
              <button
                className="button"
                onClick={() => selectTaskView("retro")}
              >
                项目复盘
              </button>
              <button className="button" onClick={exportDocument}>
                导出总文档
              </button>
              <button className="button" onClick={exportZip}>
                导出成果 ZIP
              </button>
              <button
                className="button primary"
                onClick={() => changeStatus("done")}
              >
                标记项目完成
              </button>
            </div>
          </div>
        )}
        <div className="section-heading">
          <div className="project-task-switch" aria-label="项目任务视图">
            <button
              className={taskView === "software" ? "active" : ""}
              aria-pressed={taskView === "software"}
              onClick={() => selectTaskView("software")}
            >
              <FileCode2 size={14} />
              工程交付
            </button>
            <button
              className={taskView === "auto" ? "active" : ""}
              aria-pressed={taskView === "auto"}
              onClick={() => selectTaskView("auto")}
            >
              <Play size={14} />
              自动执行
            </button>
            <button
              className={taskView === "list" ? "active" : ""}
              aria-pressed={taskView === "list"}
              onClick={() => selectTaskView("list")}
            >
              <ListTodo size={14} />
              执行清单
            </button>
            <button
              className={taskView === "catalog" ? "active" : ""}
              aria-pressed={taskView === "catalog"}
              onClick={() => selectTaskView("catalog")}
            >
              <FileText size={14} />
              成果目录
            </button>
            <button
              className={taskView === "route" ? "active" : ""}
              aria-pressed={taskView === "route"}
              onClick={() => selectTaskView("route")}
            >
              <GitBranch size={14} />
              协作路线
            </button>
            <button
              className={taskView === "retro" ? "active" : ""}
              aria-pressed={taskView === "retro"}
              onClick={() => selectTaskView("retro")}
            >
              <NotebookPen size={14} />
              项目复盘
            </button>
          </div>
          <button
            className="text-button"
            onClick={() => {
              if (canLeaveProject()) open({ type: "task", projectId: id });
            }}
          >
            <Plus size={15} />
            添加任务
          </button>
        </div>
        {taskView === "software" ? (
          <SoftwarePanel projectId={id} />
        ) : taskView === "auto" ? (
          <AutomationPanel projectId={id} />
        ) : taskView === "retro" ? (
          <ProjectRetrospective
            project={p}
            tasks={tasks}
            notes={retroNotes}
            onChange={setRetroNotes}
          />
        ) : taskView === "route" ? (
          <ProjectRoute tasks={tasks} />
        ) : taskView === "catalog" ? (
          <DeliverableIndex
            tasks={tasks}
            members={state.members}
            onOpen={(taskId) => {
              if (canLeaveProject()) open({ type: "task", id: taskId });
            }}
          />
        ) : (
          tasks.map((t) => <TaskRow key={t.id} task={t} />)
        )}
        {!tasks.length && taskView === "list" && (
          <Empty
            title="还没有任务"
            description="添加第一步行动，让目标开始推进。"
          />
        )}
      </div>
      <footer className="modal-footer">
        <button
          className="text-button danger"
          onClick={() => {
            if (
              window.confirm(
                `删除项目「${p.title}」以及它的 ${tasks.length} 个任务？此操作无法撤销。`,
              )
            ) {
              update(
                (s) => ({
                  ...s,
                  projects: s.projects.filter((p) => p.id !== id),
                  tasks: s.tasks.filter((t) => t.projectId !== id),
                }),
                `删除项目「${p.title}」`,
              );
              close();
              notify("项目已删除");
            }
          }}
        >
          <Trash2 size={15} />
          删除项目
        </button>
        <button
          className="button"
          onClick={() => {
            if ((state.templates?.length || 0) >= 100) {
              notify("模板数量已达 100 个，请先整理模板库", true);
              return;
            }
            const name = prompt("给流程模板起个名字", p.title);
            if (!name?.trim()) return;
            try {
              const template = projectToTemplate(p, tasks, name);
              update(
                (s) => ({
                  ...s,
                  templates: [template, ...(s.templates || [])],
                }),
                `保存流程模板：${template.name}`,
              );
              notify("流程模板已保存，可在目标拆解中复用");
            } catch (e) {
              notify((e as Error).message, true);
            }
          }}
        >
          保存为流程模板
        </button>
        <button
          className="button"
          onClick={exportDocument}
        >
          <Download size={16} />
          导出任务文档
        </button>
        <button className="button" onClick={exportZip}>
          <Download size={16} />
          导出成果 ZIP
        </button>
      </footer>
    </Modal>
  );
}

function TaskDetail({
  id,
  projectId,
  close,
}: {
  id?: string;
  projectId?: string;
  close: () => void;
}) {
  const { state, update, config, notify, open } = useApp();
  const initialTask = state.tasks.find((t) => t.id === id);
  const [task, setTask] = useState<Task>(
    () =>
      initialTask || {
        id: uid(),
        projectId: projectId || state.projects[0]?.id || "",
        title: "",
        description: "",
        ownerId: "",
        status: "todo",
        priority: "medium",
        deadline: dateIn(7),
        estimatedHours: 2,
        result: "",
        source: "manual",
        createdAt: now(),
        demo: false,
      },
  );
  const original = state.tasks.find((t) => t.id === task.id);
  const [busy, setBusy] = useState(false);
  const [resultBase, setResultBase] = useState(task);
  const [error, setError] = useState("");
  const [resultEditing, setResultEditing] = useState(false);
  const signal = taskReadiness(
    task,
    state.tasks,
    state.members,
    state.projects,
  );
  const projectLocked =
    !!task.dependsOn?.length ||
    state.tasks.some((t) => t.dependsOn?.includes(task.id));
  const dirty = original
    ? JSON.stringify(task) !== JSON.stringify(original)
    : !!(task.title || task.description || task.result);
  const canLeave = () =>
    !busy &&
    (!dirty || window.confirm("任务有未保存的修改，确定放弃修改并离开？"));
  const change = (patch: Partial<Task>) => setTask((t) => ({ ...t, ...patch }));
  const save = (input = task, approve = false) => {
    let draft = prepareTaskDraft(resultBase, input);
    if (approve) {
      if (!draft.result.trim()) {
        setError("请先补充交付物");
        return;
      }
      draft = recordReview(draft, "approved", "验收通过");
    }
    if (
      !taskSchema.safeParse({ ...draft, title: draft.title.trim() }).success
    ) {
      setError("请填写任务标题、所属项目、日期与有效预估工时");
      return;
    }
    const policyError =
      dependencyError([
        ...state.tasks.filter((t) => t.id !== draft.id),
        draft,
      ]) ||
      transitionError(
        { ...draft, status: original?.status || "todo" },
        draft.status,
        state.tasks,
      );
    if (policyError) {
      setError(policyError);
      return;
    }
    if (
      !state.projects.some((p) => p.id === draft.projectId) ||
      (!original && state.tasks.length >= 10000)
    ) {
      setError("项目不存在或任务数量已达上限");
      return;
    }
    update(
      (s) => ({
        ...s,
        tasks: s.tasks.some((t) => t.id === draft.id)
          ? s.tasks.map((t) =>
              t.id === draft.id ? { ...draft, title: draft.title.trim() } : t,
            )
          : [{ ...draft, title: draft.title.trim() }, ...s.tasks],
      }),
      `${id ? "更新" : "添加"}任务：${draft.title.trim()}`,
    );
    notify("任务已保存");
    close();
  };
  const execute = async () => {
    if (!original && state.tasks.length >= 10000) {
      setError("任务数量已达上限，请先整理任务");
      return;
    }
    if (!taskSchema.safeParse({ ...task, title: task.title.trim() }).success) {
      setError("请先补全有效的任务标题、项目、日期和工时");
      return;
    }
    if (signal.kind === "project-paused" || signal.kind === "project-closed") {
      setError(signal.reason);
      return;
    }
    const blocked = pendingDependencies(task, state.tasks);
    if (blocked.length) {
      setError(`请先完成前置任务：${blocked.map((t) => t.title).join("、")}`);
      return;
    }
    const executionError =
      dependencyError([...state.tasks.filter((t) => t.id !== task.id), task]) ||
      transitionError(
        { ...task, status: original?.status || "todo" },
        "review",
        state.tasks,
      );
    if (executionError) {
      setError(executionError);
      return;
    }
    const member = state.members.find((m) => m.id === task.ownerId);
    if (member?.availability === "paused") {
      setError("该员工已暂停接单，请先恢复或更换负责人");
      return;
    }
    const project = state.projects.find((p) => p.id === task.projectId);
    if (!member || !project || !task.title.trim()) {
      setError("请填写标题并选择项目和 AI 员工");
      return;
    }
    if (
      task.result &&
      !window.confirm(
        "当前成果会留存为历史版本，新成果生成后需要重新验收。继续生成？",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const { content, sources } = await api<{
        content: string;
        sources?: Passage[];
      }>("/execute", {
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          deliverable: task.deliverable,
          acceptanceCriteria: task.acceptanceCriteria,
          executionMode: task.executionMode,
          result: task.result,
          reviewNote: task.reviewNote,
        },
        project: {
          id: project.id,
          title: project.title,
          goal: project.goal,
          successCriteria: project.successCriteria,
          budget: project.budget,
        },
        member,
        knowledge: state.knowledge,
        dependencies: state.tasks
          .filter((t) => task.dependsOn?.includes(t.id) && t.status === "done")
          .map((t) => ({ title: t.title, result: t.result })),
      });
      if (
        typeof content !== "string" ||
        !content.trim() ||
        content.length > 100000
      )
        throw new Error("模型未返回有效成果，请调整要求后重试；原成果未改动。");
      const generated = replaceResult(
        prepareTaskDraft(resultBase, task),
        content,
        "ai",
        "ai",
      );
      generated.resultSources = sources;
      const next = boundWorkspaceHistory([
        ...state.tasks.filter((t) => t.id !== task.id),
        generated,
      ]).find((t) => t.id === task.id)!;
      setTask(next);
      setResultBase(next);
      update(
        (s) => ({
          ...s,
          tasks: s.tasks.some((t) => t.id === next.id)
            ? s.tasks.map((t) => (t.id === next.id ? next : t))
            : [next, ...s.tasks],
        }),
        `${member.name}为「${task.title}」生成了待验收成果`,
      );
      notify("成果已生成并保存，等待你验收");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const member = state.members.find((m) => m.id === task.ownerId);
  return (
    <Modal
      wide
      title={id ? "任务详情" : "添加一个新任务"}
      subtitle="明确交付要求，让每一次协作更有方向。"
      onClose={() => {
        if (canLeave()) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset
          className="modal-body form-grid task-form-fields"
          disabled={busy}
        >
          <div
            className={`task-readiness-notice full readiness-notice-${signal.kind}`}
          >
            <ReadinessBadge signal={signal} />
            <span>{signal.reason}</span>
          </div>
          <label className="field full">
            任务标题
            <input
              required
              maxLength={200}
              value={task.title}
              onChange={(e) => change({ title: e.target.value })}
            />
          </label>
          <label className="field full">
            所属项目
            <select
              required
              value={task.projectId}
              disabled={busy || projectLocked}
              onChange={(e) => change({ projectId: e.target.value })}
            >
              {state.projects.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            {projectLocked && (
              <small>
                已有关联依赖；如需更换项目，请先解除相关任务的前置关系。
              </small>
            )}
          </label>
          <label className="field full">
            任务说明与验收标准
            <textarea
              rows={4}
              maxLength={100000}
              value={task.description}
              onChange={(e) => change({ description: e.target.value })}
              placeholder="需要产出什么？什么样的结果算完成？"
            />
          </label>
          <label className="field">
            负责人
            <select
              value={task.ownerId}
              onChange={(e) => change({ ownerId: e.target.value })}
            >
              <option value="">待分配</option>
              {state.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.role}
                </option>
              ))}
            </select>
          </label>
          <ContractFields task={task} change={change} />
          <label className="field">
            任务状态
            <select
              value={task.status}
              onChange={(e) =>
                change({ status: e.target.value as Task["status"] })
              }
            >
              {Object.entries(statusText).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            截止日期
            <input
              required
              type="date"
              value={task.deadline}
              onChange={(e) => change({ deadline: e.target.value })}
            />
          </label>
          <label className="field">
            预估工时（小时）
            <input
              required
              type="number"
              min="0.5"
              max="500"
              step="0.5"
              value={task.estimatedHours}
              onChange={(e) =>
                change({ estimatedHours: e.target.valueAsNumber })
              }
            />
          </label>
          <label className="field full">
            优先级
            <select
              value={task.priority}
              onChange={(e) => change({ priority: e.target.value as Priority })}
            >
              {Object.entries(priorityText).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          {!!task.dependsOn?.length && (
            <div className="task-dependencies full">
              <strong>前置任务</strong>
              {state.tasks
                .filter((t) => task.dependsOn?.includes(t.id))
                .map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className={t.status === "done" ? "complete" : ""}
                    aria-label={`查看前置任务${t.title}`}
                    onClick={() => {
                      if (canLeave()) open({ type: "task", id: t.id });
                    }}
                  >
                    {t.status === "done" ? "✓" : "○"} {t.title}{" "}
                    <ArrowRight size={12} />
                  </button>
                ))}
            </div>
          )}
          <DependencyEditor task={task} change={change} disabled={busy} />
          {task.reviewNote && (
            <div className="review-history full">
              <strong>上次审批意见</strong>
              <p>{task.reviewNote}</p>
            </div>
          )}
          <div className="task-deliverable full">
            <AiReviewSummary task={task} />
            <div className="section-heading">
              <h2>
                <FileText size={17} />
                任务交付物
                {task.resultMeta && (
                  <span className="pill neutral">
                    V{task.resultMeta.number}
                  </span>
                )}
                {task.source === "ai" && task.result && (
                  <span className="pill purple">AI 生成</span>
                )}
              </h2>
              <button
                type="button"
                className="text-button"
                onClick={() => setResultEditing(!resultEditing)}
              >
                {resultEditing ? "预览成果" : "手动编辑"}
              </button>
            </div>
            {resultEditing ? (
              <textarea
                aria-label="任务交付物"
                rows={10}
                maxLength={100000}
                value={task.result}
                onChange={(e) => change({ result: e.target.value })}
              />
            ) : task.result ? (
              <div className="markdown deliverable-content">
                <ReactMarkdown>{task.result}</ReactMarkdown>
              </div>
            ) : (
              <div className="deliverable-empty">
                <Sparkles size={25} />
                <p>让 AI 员工帮你完成第一版成果</p>
                <small>输出方案、文案、代码等内容，由你审核后使用。</small>
              </div>
            )}
            <div className="deliverable-actions">
              <span>
                {!config?.configured ? (
                  "请先在设置中连接 AI 模型"
                ) : member?.type === "human" ? (
                  "真实成员的成果可手动录入"
                ) : member ? (
                  <>
                    <Avatar member={member} size="small" />
                    {member.name} · {config.model}
                  </>
                ) : (
                  "选择一位 AI 员工开始协作"
                )}
              </span>
              <button
                type="button"
                className="button primary small-button"
                disabled={
                  busy ||
                  !config?.configured ||
                  !member ||
                  member.type !== "ai" ||
                  !task.title.trim()
                }
                onClick={() => void execute()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Sparkles size={15} />
                )}{" "}
                {busy ? "正在生成..." : task.result ? "重新生成" : "生成交付物"}
              </button>
            </div>
            <small className="field-hint">
              生成后自动保存为“待验收”。AI 仅生成内容，不会在外部系统执行任务。
            </small>
            {task.result !== resultBase.result && (
              <small className="result-unsaved">
                成果有未保存的修改，保存时会留存旧版。已完成成果修改后需重新验收。
              </small>
            )}
          </div>
          <div className="full">
            <Sources passages={task.resultSources} canOpen={canLeave} />
          </div>
          <DeliveryHistory
            task={task}
            onRestore={(version) => {
              const policyError = transitionError(
                { ...task, status: original?.status || "todo" },
                "review",
                state.tasks,
              );
              if (policyError) {
                setError(policyError);
                return;
              }
              if (
                !window.confirm(
                  `恢复 V${version.number} 为待验收成果？当前编辑内容也会留存，保存任务后生效。`,
                )
              )
                return;
              const next = restoreResult(
                prepareTaskDraft(resultBase, task),
                version,
              );
              setTask(next);
              setResultBase(next);
              setResultEditing(false);
              setError("");
              notify(`已载入 V${version.number}，请保存任务`);
            }}
          />
          {error && <div className="alert error full">{error}</div>}
        </fieldset>
        <footer className="modal-footer">
          <div>
            {busy && <CancelGeneration endpoint="/execute" />}
            {original && (
              <button
                type="button"
                className="text-button danger"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(`删除任务「${original.title}」及其交付物？`)
                  ) {
                    update(
                      (s) => ({
                        ...s,
                        tasks: s.tasks
                          .filter((t) => t.id !== id)
                          .map((t) => ({
                            ...t,
                            dependsOn: t.dependsOn?.filter((dep) => dep !== id),
                          })),
                      }),
                      `删除任务：${original.title}`,
                    );
                    close();
                    notify("任务已删除");
                  }
                }}
              >
                <Trash2 size={15} />
                删除
              </button>
            )}
          </div>
          <div className="inline-controls">
            {task.result && (
              <button
                type="button"
                className="button"
                onClick={() =>
                  download(
                    `${task.title || "任务成果"}.md`,
                    task.result,
                    "text/markdown",
                  )
                }
              >
                <Download size={15} />
                导出
              </button>
            )}
            {task.result && task.status !== "done" && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => save(task, true)}
              >
                <Check size={16} />
                验收通过
              </button>
            )}
            <button className="button primary" type="submit" disabled={busy}>
              保存任务
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}

function MemberDetail({ id, close }: { id?: string; close: () => void }) {
  const { state, update, notify } = useApp();
  const original = state.members.find((m) => m.id === id);
  const [member, setMember] = useState<Member>(
    () =>
      original || {
        id: uid(),
        name: "",
        role: "",
        department: "策略部",
        skills: [],
        capacity: 40,
        prompt: "",
        color: "purple",
        type: "ai",
      },
  );
  const [skills, setSkills] = useState(member.skills.join("，"));
  const [traits, setTraits] = useState((member.traits || []).join("，"));
  const [error, setError] = useState("");
  const change = (patch: Partial<Member>) =>
    setMember((m) => ({ ...m, ...patch }));
  return (
    <Modal
      title={id ? `认识${original?.name}` : "添加你的新伙伴"}
      subtitle="定义角色、技能和工作方式。"
      onClose={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const tags = [
            ...new Set(
              skills
                .split(/[,，、\n]/)
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          ];
          if (
            !member.name.trim() ||
            !member.role.trim() ||
            !member.department.trim() ||
            tags.length > 30 ||
            tags.some((t) => t.length > 50)
          ) {
            setError(
              "请填写姓名、角色和部门，技能最多 30 项，每项不超过 50 字",
            );
            return;
          }
          const next = {
            ...member,
            name: member.name.trim(),
            role: member.role.trim(),
            department: member.department.trim(),
            skills: tags,
            traits: traits
              .split(/[,，、]/)
              .map((t) => t.trim())
              .filter(Boolean),
          };
          if (!memberSchema.safeParse(next).success) {
            setError(
              "请检查容量与技能等级；工作风格标签最多 12 项，每项不超过 30 字",
            );
            return;
          }
          if (!id && state.members.length >= 500) {
            setError("员工数量已达 500 位上限");
            return;
          }
          update(
            (s) => ({
              ...s,
              departments: s.departments.map((d) =>
                d.leadId === id && d.name !== next.department
                  ? { ...d, leadId: "" }
                  : d,
              ),
              members: id
                ? s.members.map((m) => (m.id === id ? next : m))
                : [...s.members, next],
            }),
            `${id ? "更新员工" : "迎来新伙伴"}：${next.name}`,
          );
          notify("员工资料已保存");
          close();
        }}
      >
        <div className="modal-body form-grid">
          <div className="member-preview full">
            <Avatar member={member} size="large" />
            <div>
              <strong>{member.name || "新伙伴"}</strong>
              <span>{member.role || "期待与你一起创造"}</span>
            </div>
            <div className="color-options">
              {(["purple", "blue", "orange", "green", "pink"] as const).map(
                (c) => (
                  <button
                    type="button"
                    aria-label={`${c}头像颜色`}
                    key={c}
                    className={`${c} ${member.color === c ? "selected" : ""}`}
                    onClick={() => change({ color: c })}
                  >
                    {member.color === c && <Check size={12} />}
                  </button>
                ),
              )}
            </div>
          </div>
          <label className="field">
            姓名
            <input
              required
              maxLength={50}
              value={member.name}
              onChange={(e) => change({ name: e.target.value })}
              placeholder="例如：小研"
            />
          </label>
          <label className="field">
            角色
            <input
              required
              maxLength={100}
              value={member.role}
              onChange={(e) => change({ role: e.target.value })}
              placeholder="例如：行业研究员"
            />
          </label>
          <label className="field">
            所属部门
            <input
              required
              maxLength={50}
              list="departments"
              value={member.department}
              onChange={(e) => change({ department: e.target.value })}
            />
            <datalist id="departments">
              {departmentNames(state).map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
          <label className="field">
            成员类型
            <select
              value={member.type}
              onChange={(e) =>
                change({ type: e.target.value as Member["type"] })
              }
            >
              <option value="ai">AI 员工</option>
              <option value="human">真实成员</option>
            </select>
          </label>
          <label className="field full">
            技能标签
            <input
              maxLength={1500}
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="调研，数据分析，报告写作"
            />
            <small>用逗号分隔，规划时会结合这些技能推荐分工。</small>
          </label>
          <div className="skill-level-editor full">
            <div>
              <strong>技能等级</strong>
              <span>1 基础 → 5 精通 · 由你配置，参与任务匹配</span>
            </div>
            {[
              ...new Set(
                skills
                  .split(/[,，、\n]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              ),
            ]
              .slice(0, 30)
              .map((skill) => (
                <label key={skill}>
                  <span>{skill}</span>
                  <input
                    type="range"
                    aria-label={`${skill}技能等级`}
                    min="1"
                    max="5"
                    step="1"
                    value={member.skillLevels?.[skill] ?? 3}
                    onChange={(e) =>
                      change({
                        skillLevels: {
                          ...member.skillLevels,
                          [skill]: Number(e.target.value),
                        },
                      })
                    }
                  />
                  <b>{member.skillLevels?.[skill] ?? 3}/5</b>
                </label>
              ))}
          </div>
          <label className="field full">
            工作风格标签
            <input
              value={traits}
              maxLength={350}
              onChange={(e) => setTraits(e.target.value)}
              placeholder="结构化，重证据，擅长创意"
            />
          </label>
          <label className="field full">
            接单状态
            <select
              value={member.availability || "available"}
              onChange={(e) =>
                change({
                  availability: e.target.value as Member["availability"],
                })
              }
            >
              <option value="available">可接单 · 参与自动推荐</option>
              <option value="paused">暂停 · 不参与自动推荐</option>
            </select>
          </label>
          <label className="field full">
            计划可用工时
            <input
              required
              type="number"
              min="1"
              max="80"
              value={member.capacity}
              onChange={(e) => change({ capacity: e.target.valueAsNumber })}
            />
            <small>
              用于比较当前待办工时与计划容量，不表示 AI 实际计算耗时。
            </small>
          </label>
          <label className="field full">
            角色指令
            <textarea
              rows={5}
              maxLength={10000}
              value={member.prompt}
              onChange={(e) => change({ prompt: e.target.value })}
              placeholder="描述专业背景、输出风格与工作要求，AI 将根据这些指令生成成果。"
            />
          </label>
          {error && <div className="alert error full">{error}</div>}
        </div>
        <footer className="modal-footer">
          <div>
            {id && (
              <button
                type="button"
                className="text-button danger"
                onClick={() => {
                  const count = state.tasks.filter(
                    (t) => t.ownerId === id,
                  ).length;
                  if (
                    window.confirm(
                      `移除${member.name}？${count} 个关联任务将改为待分配，任务内容保留。`,
                    )
                  ) {
                    update(
                      (s) => ({
                        ...s,
                        members: s.members.filter((m) => m.id !== id),
                        departments: s.departments.map((d) =>
                          d.leadId === id ? { ...d, leadId: "" } : d,
                        ),
                        tasks: s.tasks.map((t) =>
                          t.ownerId === id ? { ...t, ownerId: "" } : t,
                        ),
                      }),
                      `移除员工：${member.name}`,
                    );
                    close();
                    notify("员工已移除，关联任务已改为待分配");
                  }
                }}
              >
                <Trash2 size={15} />
                移除员工
              </button>
            )}
          </div>
          <button type="submit" className="button primary">
            <Check size={16} />
            保存员工
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function KnowledgeDetail({ id, close }: { id?: string; close: () => void }) {
  const { state, update, notify } = useApp();
  const original = state.knowledge.find((k) => k.id === id);
  const [note, setNote] = useState<Knowledge>(
    () =>
      original || {
        id: uid(),
        title: "",
        content: "",
        category: "资料",
        updatedAt: now(),
      },
  );
  const [preview, setPreview] = useState(false);
  return (
    <Modal
      wide
      title={id ? "编辑知识笔记" : "记录一个新想法"}
      subtitle="支持 Markdown，保留有价值的背景与经验。"
      onClose={() => {
        if (
          JSON.stringify(note) === JSON.stringify(original) ||
          (!note.title && !note.content) ||
          confirm("笔记有未保存的修改，确定放弃并离开？")
        )
          close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.title.trim()) return;
          const next = { ...note, title: note.title.trim(), updatedAt: now() };
          update(
            (s) => ({
              ...s,
              knowledge: [next, ...s.knowledge.filter((k) => k.id !== next.id)],
            }),
            `保存知识笔记：${next.title}`,
          );
          notify("笔记已保存");
          close();
        }}
      >
        <div className="modal-body form-grid">
          <label className="field full">
            笔记标题
            <input
              required
              maxLength={200}
              value={note.title}
              onChange={(e) =>
                setNote((n) => ({ ...n, title: e.target.value }))
              }
              placeholder="给这个想法起个名字"
            />
          </label>
          <label className="field">
            分类
            <select
              value={note.category}
              onChange={(e) =>
                setNote((n) => ({
                  ...n,
                  category: e.target.value as Knowledge["category"],
                }))
              }
            >
              {["资料", "灵感", "规范", "复盘"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="field full">
            所属项目
            <select
              aria-label="知识所属项目"
              value={note.projectId || ""}
              onChange={(e) =>
                setNote((n) => ({
                  ...n,
                  projectId: e.target.value || undefined,
                }))
              }
            >
              <option value="">公共知识 · 所有项目可检索</option>
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <small>项目资料仅供对应项目检索；公共知识可供所有项目参考。</small>
          </label>
          <div className="note-mode">
            <button
              className={!preview ? "active" : ""}
              type="button"
              onClick={() => setPreview(false)}
            >
              编辑
            </button>
            <button
              className={preview ? "active" : ""}
              type="button"
              onClick={() => setPreview(true)}
            >
              预览
            </button>
          </div>
          <div className="field full">
            {preview ? (
              <div className="markdown note-preview">
                <ReactMarkdown>{note.content || "*还没有内容*"}</ReactMarkdown>
              </div>
            ) : (
              <textarea
                aria-label="笔记内容"
                rows={14}
                maxLength={100000}
                value={note.content}
                onChange={(e) =>
                  setNote((n) => ({ ...n, content: e.target.value }))
                }
                placeholder="写下你的背景资料、灵感或经验..."
              />
            )}
            <small>
              {note.content.length.toLocaleString()} 字符 ·
              保存后按相关性检索片段供 AI 参考
            </small>
          </div>
        </div>
        <footer className="modal-footer">
          <div>
            {id && (
              <button
                type="button"
                className="text-button danger"
                onClick={() => {
                  if (window.confirm(`删除笔记「${note.title}」？`)) {
                    update(
                      (s) => ({
                        ...s,
                        knowledge: s.knowledge.filter((k) => k.id !== id),
                      }),
                      `删除知识笔记：${note.title}`,
                    );
                    close();
                    notify("笔记已删除");
                  }
                }}
              >
                <Trash2 size={15} />
                删除笔记
              </button>
            )}
          </div>
          <div className="inline-controls">
            <button
              type="button"
              className="button"
              onClick={() =>
                download(
                  `${note.title || "笔记"}.md`,
                  note.content,
                  "text/markdown",
                )
              }
            >
              <Download size={16} />
              导出
            </button>
            <button type="submit" className="button primary">
              保存笔记
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}
