import { useId, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  GitBranch,
  Link2,
  ListTodo,
  Pause,
  Play,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import { useApp } from "./context";
import { Avatar, Empty, Modal } from "./components";
import { dateIn, dateLabel, statusText, type Task } from "./domain";
import { memberLoad } from "./insights";
import {
  actionableTasks,
  downstreamIds,
  taskLayers,
  taskReadiness,
  type Readiness,
} from "../shared/execution.mjs";

export function ReadinessBadge({ signal }: { signal: Readiness }) {
  return (
    <span
      className={`readiness-badge readiness-${signal.kind}`}
      title={signal.reason}
    >
      <i />
      {signal.label}
    </span>
  );
}

export function ActionQueue({ projectId = "" }: { projectId?: string }) {
  const { state, open } = useApp();
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const items = actionableTasks(state, dateIn(), projectId);
  const filtered = items.filter(
    ({ signal }) =>
      filter === "all" ||
      (filter === "ready"
        ? ["ready", "doing"].includes(signal.kind)
        : ["blocked", "unassigned", "member-paused"].includes(signal.kind)),
  );
  return (
    <section className="action-queue" aria-label="行动队列">
      <header>
        <h2>
          <ListTodo size={15} />
          行动队列 <span>{items.length}</span>
        </h2>
        <span
          className="queue-rule"
          title="仅统计进行中项目的未完成任务；优先验收，再按逾期、任务状态、优先级和截止日期排序。"
        >
          排序规则 ⓘ
        </span>
      </header>
      <div className="action-tabs">
        {[
          ["all", "优先处理"],
          ["ready", "可推进"],
          ["blocked", "有阻塞"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={filter === id}
            className={filter === id ? "active" : ""}
            onClick={() => {
              setFilter(id);
              setExpanded(false);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="action-queue-list">
        {filtered
          .slice(0, expanded ? 12 : 3)
          .map(({ task, signal, overdue }, index) => {
            const owner = state.members.find((m) => m.id === task.ownerId);
            return (
              <button
                className="action-item"
                key={task.id}
                onClick={() => open({ type: "task", id: task.id })}
              >
                <div>
                  <span className="action-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <ReadinessBadge signal={signal} />
                  {overdue && <small className="action-overdue">逾期</small>}
                  <ArrowUpRight size={12} />
                </div>
                <strong>{task.title}</strong>
                <p>{signal.reason}</p>
                <footer>
                  <span>
                    {owner?.name || "待分配"} · {dateLabel(task.deadline)}
                  </span>
                  <b>
                    {signal.kind === "review"
                      ? "审阅成果"
                      : signal.kind === "blocked"
                        ? "检查依赖"
                        : signal.kind === "unassigned"
                          ? "安排分工"
                          : "查看任务"}{" "}
                    <ArrowRight size={11} />
                  </b>
                </footer>
              </button>
            );
          })}
      </div>
      {!filtered.length && (
        <div className="queue-clear">
          <ShieldCheck size={22} />
          <strong>
            {filter === "blocked"
              ? "当前没有阻塞"
              : filter === "ready"
                ? "暂时没有可推进任务"
                : "当前没有待办"}
          </strong>
          <p>
            {filter === "ready"
              ? "可先验收成果或解除前置阻塞。"
              : "仅列出进行中项目的任务。"}
          </p>
        </div>
      )}
      {filtered.length > 3 && (
        <button className="queue-expand" onClick={() => setExpanded(!expanded)}>
          {expanded ? "收起队列" : `展开更多 · 共 ${filtered.length} 项`}
        </button>
      )}
      {expanded && filtered.length > 12 && (
        <small className="queue-limit">
          已展示前 12 项，其余可在任务看板查看。
        </small>
      )}
    </section>
  );
}

export function StaffDesk({ id, close }: { id: string; close: () => void }) {
  const { state, open, update } = useApp();
  const [filter, setFilter] = useState("active");
  const member = state.members.find((m) => m.id === id);
  if (!member)
    return (
      <Modal title="员工不存在" onClose={close}>
        <Empty title="这个工位已变动" description="关闭面板后查看最新团队。" />
      </Modal>
    );
  const load = memberLoad(state, member);
  const all = state.tasks.filter((t) => t.ownerId === id);
  const actionable = actionableTasks(state, dateIn()).filter(
    (x) => x.task.ownerId === id,
  );
  const records = all.map((task) => ({
    task,
    signal: taskReadiness(task, state.tasks, state.members, state.projects),
  }));
  const tasks = records.filter(
    ({ task, signal }) =>
      filter === "all" ||
      (filter === "review"
        ? signal.kind === "review"
        : filter === "blocked"
          ? [
              "blocked",
              "member-paused",
              "project-paused",
              "project-closed",
            ].includes(signal.kind)
          : task.status !== "done"),
  );
  const order = new Map(actionable.map((item, i) => [item.task.id, i]));
  tasks.sort(
    (a, b) => (order.get(a.task.id) ?? 99999) - (order.get(b.task.id) ?? 99999),
  );
  return (
    <Modal
      wide
      title={`${member.name}的工作面板`}
      subtitle="查看当前分工、卡点和成果；执行状态来自任务记录。"
      onClose={close}
    >
      <div className="modal-body staff-workspace">
        <div className="staff-identity">
          <Avatar member={member} size="large" />
          <div>
            <h3>
              {member.name}
              <span>{member.type === "ai" ? "AI 员工" : "真实成员"}</span>
            </h3>
            <p>
              {member.department} / {member.role}
            </p>
          </div>
          <button
            className="button"
            onClick={() => open({ type: "member", id })}
          >
            <Settings2 size={14} />
            编辑档案
          </button>
        </div>
        <div className="staff-work-stats">
          <span>
            <small>计划负载</small>
            <b className={load.load > 100 ? "action-overdue" : ""}>
              {load.load}
              <em>%</em>
            </b>
            <p>
              {load.hours} / {member.capacity}h · 非运行时长
            </p>
          </span>
          <span>
            <small>待办任务</small>
            <b>{load.tasks.length}</b>
            <p>{all.filter((t) => t.status === "done").length} 项已完成</p>
          </span>
          <span>
            <small>等待验收</small>
            <b>{all.filter((t) => t.status === "review").length}</b>
            <p>由你审阅后确认</p>
          </span>
        </div>
        <div className="staff-specialties">
          {member.skills.map((skill) => (
            <span key={skill}>
              {skill} <b>{member.skillLevels?.[skill] ?? 3}/5</b>
            </span>
          ))}
        </div>
        <div className="staff-availability">
          <span>
            <i className={member.availability === "paused" ? "paused" : ""} />
            {member.availability === "paused"
              ? "已暂停新的自动分配"
              : "参与任务自动推荐"}
          </span>
          <button
            onClick={() =>
              update(
                (s) => ({
                  ...s,
                  members: s.members.map((m) =>
                    m.id === id
                      ? {
                          ...m,
                          availability:
                            m.availability === "paused"
                              ? "available"
                              : "paused",
                        }
                      : m,
                  ),
                }),
                `${member.name}${member.availability === "paused" ? "恢复" : "暂停"}接单`,
              )
            }
          >
            {member.availability === "paused" ? (
              <Play size={12} />
            ) : (
              <Pause size={12} />
            )}{" "}
            {member.availability === "paused" ? "恢复接单" : "暂停接单"}
          </button>
        </div>
        <div className="staff-task-tabs">
          {[
            ["active", "待办"],
            ["review", "待验收"],
            ["blocked", "阻塞 / 暂停"],
            ["all", "全部任务"],
          ].map(([key, label]) => (
            <button
              key={key}
              aria-pressed={key === filter}
              className={key === filter ? "active" : ""}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="staff-task-list">
          {tasks.map(({ task, signal }) => (
            <button
              key={task.id}
              onClick={() => open({ type: "task", id: task.id })}
            >
              <div>
                <ReadinessBadge signal={signal} />
                <small>
                  {dateLabel(task.deadline)} · {task.estimatedHours}h
                </small>
              </div>
              <h4>
                {task.title}
                <ArrowUpRight size={14} />
              </h4>
              <p>{signal.reason}</p>
              <footer>
                {state.projects.find((p) => p.id === task.projectId)?.title}
                {task.demo && <span>示例</span>}
              </footer>
            </button>
          ))}
        </div>
        {!tasks.length && (
          <Empty
            title="这个分类下没有任务"
            description="在目标拆解中安排分工后，任务会自动显示在这里。"
          />
        )}
      </div>
      <footer className="modal-footer">
        <span className="staff-footnote">
          AI 仅在你发起生成时调用模型，不会在后台自行工作。
        </span>
        <button className="button" onClick={close}>
          返回办公室
        </button>
      </footer>
    </Modal>
  );
}

export function ProjectRoute({ tasks }: { tasks: Task[] }) {
  const { state, open } = useApp();
  const [hovered, setHovered] = useState("");
  const arrowId = useId();
  if (tasks.length > 100)
    return (
      <Empty
        title="此项目任务较多"
        description="路线图最多展示 100 个任务；请使用执行清单查看这个项目。"
      />
    );
  const layers = taskLayers(tasks);
  const positions = new Map(
    layers.flatMap((items, col) =>
      items.map(
        (task, row) =>
          [task.id, { x: col * 268 + 20, y: row * 180 + 50 }] as const,
      ),
    ),
  );
  const edges = tasks.flatMap((task) =>
    (task.dependsOn || []).flatMap((parent) =>
      positions.has(parent) ? [{ from: parent, to: task.id }] : [],
    ),
  );
  const width = Math.max(600, layers.length * 268 + 14);
  const height = Math.max(260, ...layers.map((l) => l.length * 180 + 55));
  const ready = tasks.filter((t) =>
    ["ready", "doing"].includes(
      taskReadiness(t, state.tasks, state.members, state.projects).kind,
    ),
  ).length;
  return (
    <section className="project-route" aria-label="项目协作路线">
      <div className="route-description">
        <div>
          <GitBranch size={16} />
          <strong>从交付到交接，一条清晰的路线</strong>
        </div>
        <p>
          {edges.length
            ? `共 ${edges.length} 条前置关系 · ${ready} 项可推进。连线表示依赖，同列任务无先后依赖。`
            : "尚未设置前置关系，当前任务均为独立安排。可在任务详情中调整依赖。"}
        </p>
        <small>左右滑动查看后续阶段 · 点击任务查看详情</small>
      </div>
      {!!tasks.length && (
        <div
          className="route-scroll"
          tabIndex={0}
          aria-label="可横向滚动的任务路线"
        >
          <div className="route-canvas" style={{ width, height }}>
            {layers.map((_, index) => (
              <div
                className="route-stage"
                key={index}
                style={{ left: index * 268 + 20 }}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {index === 0 ? "起点 / 独立任务" : `协作阶段 ${index + 1}`}
              </div>
            ))}
            <svg width={width} height={height} aria-hidden="true">
              <defs>
                <marker
                  id={arrowId}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto"
                >
                  <path d="M1 1L7 4L1 7" fill="none" stroke="#9eb2ae" />
                </marker>
              </defs>
              {edges.map((edge) => {
                const from = positions.get(edge.from)!;
                const to = positions.get(edge.to)!;
                const x = from.x + 234,
                  y = from.y + 74;
                const active = hovered === edge.from || hovered === edge.to;
                return (
                  <path
                    key={edge.from + edge.to}
                    className={active ? "connected" : ""}
                    markerEnd={`url(#${arrowId})`}
                    d={`M${x} ${y}C${x + 20} ${y} ${to.x - 20} ${to.y + 74} ${to.x} ${to.y + 74}`}
                    fill="none"
                  />
                );
              })}
            </svg>
            {tasks.map((task) => {
              const pos = positions.get(task.id);
              if (!pos) return null;
              const signal = taskReadiness(
                task,
                state.tasks,
                state.members,
                state.projects,
              );
              const owner = state.members.find((m) => m.id === task.ownerId);
              return (
                <button
                  className={`route-task route-task-${signal.kind}`}
                  key={task.id}
                  style={{ left: pos.x, top: pos.y }}
                  onMouseEnter={() => setHovered(task.id)}
                  onMouseLeave={() => setHovered("")}
                  onFocus={() => setHovered(task.id)}
                  onBlur={() => setHovered("")}
                  onClick={() => open({ type: "task", id: task.id })}
                >
                  <div>
                    <ReadinessBadge signal={signal} />
                    <span>{task.estimatedHours}h</span>
                  </div>
                  <h4>{task.title}</h4>
                  <footer>
                    <Avatar member={owner} size="small" />
                    <span>{owner?.name || "待分配"}</span>
                    <small>{dateLabel(task.deadline)}</small>
                  </footer>
                  <p>
                    {task.dependsOn?.length
                      ? `${task.dependsOn.length} 项前置 · ${signal.pending.length} 项未完成`
                      : "无前置依赖"}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {!tasks.length && (
        <Empty
          title="从第一项任务开始"
          description="添加任务后即可查看协作路线。"
        />
      )}
    </section>
  );
}

export function DependencyEditor({
  task,
  change,
  disabled = false,
}: {
  task: Task;
  change: (patch: Partial<Task>) => void;
  disabled?: boolean;
}) {
  const { state } = useApp();
  const [query, setQuery] = useState("");
  const forbidden = new Set(downstreamIds(task.id, state.tasks));
  const choices = state.tasks.filter(
    (t) => t.projectId === task.projectId && t.id !== task.id,
  );
  const matched = choices.filter((t) =>
    t.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <details className="dependency-editor full">
      <summary>
        <Link2 size={15} />
        <strong>前置关系</strong>
        <span>{task.dependsOn?.length || 0} 项已关联</span>
        <small>调整</small>
      </summary>
      <div className="dependency-body">
        <p>先完成前置任务，才能推进当前任务。后续任务不可选，避免循环依赖。</p>
        {!!task.dependsOn?.length && (
          <div className="selected-dependencies">
            {choices
              .filter((t) => task.dependsOn?.includes(t.id))
              .map((t) => (
                <span key={t.id}>
                  {t.title}
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`解除前置任务${t.title}`}
                    onClick={() =>
                      change({
                        dependsOn: task.dependsOn?.filter((id) => id !== t.id),
                      })
                    }
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
          </div>
        )}
        {choices.length > 6 && (
          <label className="dependency-search">
            <Search size={14} />
            <input
              aria-label="搜索前置任务"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索同项目任务"
            />
          </label>
        )}
        <div className="dependency-choices">
          {matched.slice(0, 50).map((t) => (
            <label
              key={t.id}
              className={forbidden.has(t.id) ? "not-allowed" : ""}
            >
              <input
                type="checkbox"
                disabled={
                  disabled ||
                  forbidden.has(t.id) ||
                  (!task.dependsOn?.includes(t.id) &&
                    (task.dependsOn?.length || 0) >= 100)
                }
                checked={task.dependsOn?.includes(t.id) || false}
                onChange={(e) =>
                  change({
                    dependsOn: e.target.checked
                      ? [...(task.dependsOn || []), t.id]
                      : task.dependsOn?.filter((id) => id !== t.id),
                  })
                }
              />
              <span>
                {t.title}
                <small>
                  {forbidden.has(t.id)
                    ? "后续任务 · 不可作为前置"
                    : statusText[t.status]}
                </small>
              </span>
              {t.status === "done" && <Check size={13} />}
            </label>
          ))}
        </div>
        {!matched.length && (
          <p className="dependency-empty">
            {choices.length ? "没有匹配任务" : "当前项目还没有其他任务。"}
          </p>
        )}
        {matched.length > 50 && <small>显示前 50 项，请用搜索缩小范围。</small>}
      </div>
    </details>
  );
}
