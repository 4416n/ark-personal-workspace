import { useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Sparkles,
  Plus,
  ArrowRight,
  ArrowUpRight,
  Search,
  Target,
  Clock3,
  Check,
  RotateCcw,
  CircleCheck,
  AlertTriangle,
  UserRound,
  FileText,
  ListTodo,
  Wallet,
  Download,
  ChevronRight,
} from "lucide-react";
import { useApp } from "./context";
import { Avatar, Empty, PageHeading, ProjectCard } from "./components";
import { dateIn, dateLabel } from "./domain";
import {
  departmentNames,
  departmentStats,
  memberLoad,
  pendingDependencies,
  workspaceRisks,
} from "./insights";
import { rankMembers } from "../shared/matching.mjs";
import { download } from "./store";
import { recordReview } from "./delivery";
import { ReviewTrail } from "./delivery-ui";
import { TemplateLibrary } from "./templates-ui";
import { Sources } from "./runs-ui";

export function Goals() {
  const { state, open } = useApp();
  const [goal, setGoal] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const projects = state.projects.filter(
    (p) =>
      (filter === "all" || p.status === filter) &&
      `${p.title} ${p.goal}`.toLowerCase().includes(query.toLowerCase()),
  );
  const templates = [
    "30 天上线我的个人作品网站",
    "建立每周两篇的内容创作流程",
    "把零散笔记整理成个人知识库",
  ];
  return (
    <>
      <PageHeading
        title="目标拆解"
        description="把一个目标拆成部门任务，再把每项工作交给合适的人。"
        action={
          <div className="inline-controls">
            <TemplateLibrary />
            <button
              className="button primary"
              onClick={() => open({ type: "project-new" })}
            >
              <Plus size={15} />
              拆解新目标
            </button>
          </div>
        }
      />
      <section className="goal-intake">
        <div className="goal-intake-content">
          <span>
            <Sparkles size={14} />
            一句话，下达目标
          </span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              open({ type: "project-new", goal: goal.trim() });
            }}
          >
            <input
              aria-label="一句话目标"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              maxLength={1000}
              placeholder="例如：这个月底，完成个人产品的第一版并收集 10 份反馈"
            />
            <button type="submit">
              <Sparkles size={14} />
              开始拆解
            </button>
          </form>
          <div className="goal-examples">
            {templates.map((t) => (
              <button key={t} onClick={() => setGoal(t)}>
                {t}
                <ArrowUpRight size={10} />
              </button>
            ))}
          </div>
        </div>
        <div className="goal-route-art" aria-hidden="true">
          <span>目标</span>
          <svg viewBox="0 0 90 100">
            <path
              d="M0 50C44 50 26 8 90 8M0 50C44 50 26 35 90 35M0 50C44 50 26 65 90 65M0 50C44 50 26 92 90 92"
              fill="none"
              stroke="#938cc9"
              strokeWidth="1.4"
            />
          </svg>
          <div>
            {departmentNames(state)
              .slice(0, 4)
              .map((name) => (
                <i key={name}>{name}</i>
              ))}
          </div>
          <div className="route-people">
            <span>•••</span>
            <span>•••</span>
            <span>•••</span>
            <span>•••</span>
          </div>
        </div>
      </section>
      <div className="goal-process">
        <span>
          <b>01</b>明确目标与验收标准
        </span>
        <ChevronRight size={12} />
        <span>
          <b>02</b>拆解任务与前置关系
        </span>
        <ChevronRight size={12} />
        <span>
          <b>03</b>比较能力并调整分工
        </span>
        <ChevronRight size={12} />
        <span>
          <b>04</b>批准计划，开始执行
        </span>
      </div>
      <div className="filter-toolbar">
        <div className="tabs">
          {[
            ["all", "全部目标"],
            ["active", "推进中"],
            ["paused", "已暂停"],
            ["done", "已达成"],
          ].map(([v, label]) => (
            <button
              key={v}
              className={filter === v ? "active" : ""}
              onClick={() => setFilter(v)}
            >
              {label}
              <span>
                {
                  state.projects.filter((p) => v === "all" || p.status === v)
                    .length
                }
              </span>
            </button>
          ))}
        </div>
        <div className="search-field compact">
          <Search size={15} />
          <input
            aria-label="搜索目标"
            placeholder="搜索目标名称或内容"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="projects-grid goals-grid">
        {projects.map((p) => (
          <ProjectCard project={p} key={p.id} />
        ))}
      </div>
      {!projects.length && (
        <Empty
          icon={<Target size={28} />}
          title="给公司一个明确的方向"
          description="先写下想实现的结果，再和团队一起拆解行动。"
          action={
            <button
              className="button primary"
              onClick={() => open({ type: "project-new" })}
            >
              下达第一个目标
              <ArrowRight size={14} />
            </button>
          }
        />
      )}
    </>
  );
}

export function Decisions() {
  const { state, update, open, notify } = useApp();
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState("");
  const [feedback, setFeedback] = useState("");
  const all = workspaceRisks(state);
  const issues = all.filter((r) => filter === "all" || r.kind === filter);
  const selectedIssue = issues.find((r) => r.id === selected) || issues[0];
  const task = selectedIssue?.task;
  const owner = state.members.find((m) => m.id === task?.ownerId);
  const project = state.projects.find((p) => p.id === task?.projectId);
  const blocked = task ? pendingDependencies(task, state.tasks) : [];
  const decide = (status: "done" | "doing") => {
    if (!task) return;
    if (status === "doing" && !feedback.trim()) {
      notify("请写明返工要求，方便员工继续修改", true);
      return;
    }
    if (status === "done" && !task.result.trim()) {
      notify("请先补充交付物后再验收", true);
      return;
    }
    if (status === "done" && blocked.length) {
      notify("请先完成前置任务后再验收", true);
      return;
    }
    update(
      (s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === task.id
            ? recordReview(
                t,
                status === "done" ? "approved" : "returned",
                feedback,
              )
            : t,
        ),
      }),
      `${status === "done" ? "验收通过" : "退回修改"}：${task.title}`,
    );
    setFeedback("");
    setSelected("");
    notify(
      status === "done"
        ? "已验收，目标进度同步更新"
        : "已退回进行中，修改意见已保留",
    );
  };
  return (
    <>
      <PageHeading
        title="决策中心"
        description="把注意力放在需要你判断的事情上。成果验收、任务分工与进度风险，集中处理。"
      />
      <div className="decision-summary">
        {[
          { id: "all", text: "全部待决策", icon: ListTodo },
          { id: "review", text: "成果待验收", icon: FileText },
          { id: "unassigned", text: "需要分工", icon: UserRound },
          { id: "overdue", text: "排期需调整", icon: Clock3 },
        ].map((f) => (
          <button
            key={f.id}
            className={filter === f.id ? "active" : ""}
            onClick={() => {
              setFilter(f.id);
              setSelected("");
              setFeedback("");
            }}
          >
            <f.icon size={17} />
            <span>{f.text}</span>
            <strong>
              {all.filter((r) => f.id === "all" || r.kind === f.id).length}
            </strong>
          </button>
        ))}
      </div>
      {!issues.length ? (
        <div className="panel">
          <Empty
            icon={<CircleCheck size={32} />}
            title="当前没有待处理事项"
            description="新交付物、未分配任务和逾期风险会出现在这里。"
          />
        </div>
      ) : (
        <div className="decision-workbench">
          <div className="decision-queue">
            <div className="queue-caption">
              待处理队列<span>{issues.length}</span>
            </div>
            {issues.map((r) => (
              <button
                key={r.id}
                className={selectedIssue?.id === r.id ? "selected" : ""}
                onClick={() => {
                  setSelected(r.id);
                  setFeedback("");
                }}
              >
                <span className={`queue-type ${r.kind}`}>
                  {r.kind === "review"
                    ? "成果验收"
                    : r.kind === "overdue"
                      ? "逾期风险"
                      : "待分配"}
                </span>
                <h3>{r.title}</h3>
                <p>
                  {state.projects.find((p) => p.id === r.task.projectId)?.title}
                </p>
                <footer>
                  <span>
                    {state.members.find((m) => m.id === r.task.ownerId)?.name ||
                      "待分配"}
                  </span>
                  <span>
                    {dateLabel(r.task.deadline)}
                    <ChevronRight size={12} />
                  </span>
                </footer>
              </button>
            ))}
          </div>
          {task && (
            <section className="decision-detail">
              <header>
                <div>
                  <span>{project?.title}</span>
                  <h2>{task.title}</h2>
                </div>
                <button
                  className="button"
                  onClick={() => open({ type: "task", id: task.id })}
                >
                  完整任务
                  <ArrowUpRight size={13} />
                </button>
              </header>
              <div className="decision-assignee">
                <Avatar member={owner} size="small" />
                <strong>{owner?.name || "待分配"}</strong>
                <span>{owner?.role || "尚未安排负责人"}</span>
                <span className="decision-due">
                  {task.deadline} 截止 · {task.estimatedHours}h
                </span>
              </div>
              <details className="acceptance-requirements" open>
                <summary>任务要求与验收依据</summary>
                <p>{task.description || "暂未补充任务说明。"}</p>
                {project?.successCriteria && (
                  <p>
                    <strong>项目验收标准：</strong>
                    {project.successCriteria}
                  </p>
                )}
              </details>
              {selectedIssue?.kind === "review" ? (
                <>
                  <div className="delivery-title">
                    <FileText size={15} />
                    <h3>待验收交付物</h3>
                    <span>
                      {task.source === "ai"
                        ? "AI 生成"
                        : task.demo
                          ? "示例成果"
                          : "手动提交"}
                    </span>
                  </div>
                  {task.result ? (
                    <div className="markdown decision-result">
                      <ReactMarkdown>{task.result}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="no-delivery">
                      <AlertTriangle size={21} />
                      <p>还没有交付物内容，请补充后再验收。</p>
                      <button
                        className="button"
                        onClick={() => open({ type: "task", id: task.id })}
                      >
                        补充交付物
                      </button>
                    </div>
                  )}
                  {blocked.length > 0 && (
                    <div className="alert error">
                      前置任务未完成：{blocked.map((t) => t.title).join("、")}
                    </div>
                  )}
                  {!!(task.reviews?.length || task.reviewNote) && (
                    <details className="decision-review-trail">
                      <summary>
                        历史审批意见（{task.reviews?.length || 0}）
                      </summary>
                      <ReviewTrail task={task} />
                    </details>
                  )}
                  <div className="review-compose">
                    <Sources passages={task.resultSources} />
                    <label className="field">
                      审批意见
                      <textarea
                        aria-label="审批意见"
                        rows={3}
                        value={feedback}
                        maxLength={10000}
                        onChange={(e) => setFeedback(e.target.value)}
                        placeholder="通过时可补充备注；退回时请写明需要调整的内容。"
                      />
                    </label>
                    <div>
                      <button
                        className="button"
                        onClick={() => decide("doing")}
                      >
                        <RotateCcw size={14} />
                        退回修改
                      </button>
                      <button
                        className="button primary"
                        disabled={!task.result || !!blocked.length}
                        onClick={() => decide("done")}
                      >
                        <Check size={14} />
                        验收通过
                      </button>
                    </div>
                  </div>
                </>
              ) : selectedIssue?.kind === "unassigned" ? (
                <div className="assignment-recommendations">
                  <h3>
                    推荐负责人 <small>按技能匹配、能力配置和剩余容量排序</small>
                  </h3>
                  {rankMembers(
                    task.skills ||
                      task.description.match(
                        /开发|文案|设计|调研|技术|写作|复盘|项目管理/g,
                      ) ||
                      [],
                    state.members,
                    state.tasks.filter((t) => t.id !== task.id),
                    task.estimatedHours,
                  ).map((r) => (
                    <div key={r.member.id}>
                      <Avatar member={r.member} />
                      <section>
                        <strong>
                          {r.member.name}
                          <span>{r.member.role}</span>
                        </strong>
                        <p>{r.reason}</p>
                      </section>
                      <b>
                        {r.score}
                        <small>匹配分</small>
                      </b>
                      <button
                        className="button"
                        disabled={!r.available}
                        onClick={() => {
                          update(
                            (s) => ({
                              ...s,
                              tasks: s.tasks.map((t) =>
                                t.id === task.id
                                  ? { ...t, ownerId: r.member.id }
                                  : t,
                              ),
                            }),
                            `将「${task.title}」分配给${r.member.name}`,
                          );
                          notify("负责人已更新");
                        }}
                      >
                        分配
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="overdue-resolution">
                  <Clock3 size={32} />
                  <h3>这个任务需要重新安排时间</h3>
                  <p>
                    原计划在 {dateLabel(task.deadline)}{" "}
                    完成。可以检查当前进展，重新约定合理的截止日期。
                  </p>
                  <button
                    className="button primary"
                    onClick={() => open({ type: "task", id: task.id })}
                  >
                    调整排期与负责人
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}

export function Analytics() {
  const { state, open } = useApp();
  const [month, setMonth] = useState("all");
  const months = [
    ...new Set(state.tasks.map((t) => t.deadline.slice(0, 7))),
  ].sort();
  const tasks = state.tasks.filter(
    (t) => month === "all" || t.deadline.startsWith(month),
  );
  const done = tasks.filter((t) => t.status === "done").length;
  const overdue = tasks.filter(
    (t) => t.status !== "done" && t.deadline < dateIn(),
  ).length;
  const rate = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const budget = state.projects.reduce((s, p) => s + (p.budget || 0), 0);
  const depts = departmentNames(state).map((name) => ({
    name,
    ...departmentStats({ ...state, tasks }, name),
  }));
  const statuses = [
    { key: "todo", label: "待开始", color: "#bfc6d0" },
    { key: "doing", label: "进行中", color: "#8593ca" },
    { key: "review", label: "待验收", color: "#d1b381" },
    { key: "done", label: "已完成", color: "#80ae98" },
  ];
  const maxHours = Math.max(1, ...depts.map((d) => d.hours));
  const exportReport = () =>
    download(
      `方舟经营简报-${dateIn()}.md`,
      `# 工作台经营简报\n\n统计日期：${dateIn()}\n任务范围：${month === "all" ? "全部任务" : month + "计划截止任务"}\n\n- 任务总数：${tasks.length}\n- 已完成：${done}\n- 完成率：${rate}%\n- 逾期未完成：${overdue}\n- 全部项目计划预算：¥${budget}\n\n## 部门待办负载\n\n${depts.map((d) => `- ${d.name}：${d.hours}/${d.capacity}h，${d.active.length} 项待办`).join("\n")}\n\n预算是计划值，非实际收入或支出。`,
      "text/markdown",
    );
  return (
    <>
      <PageHeading
        title="经营数据"
        description="从任务、部门和目标看执行情况。所有统计来自你的工作台记录。"
        action={
          <div className="inline-controls">
            <select
              aria-label="统计月份"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              <option value="all">全部计划</option>
              {months.map((m) => (
                <option value={m} key={m}>
                  {m}
                </option>
              ))}
            </select>
            <button className="button" onClick={exportReport}>
              <Download size={14} />
              导出简报
            </button>
          </div>
        }
      />
      <div className="analytics-metrics">
        {[
          {
            label: "任务完成率",
            value: `${rate}%`,
            detail: `统计范围内 ${done}/${tasks.length} 个任务完成`,
            icon: Target,
          },
          {
            label: "待完成工作量",
            value: `${tasks.filter((t) => t.status !== "done").reduce((s, t) => s + t.estimatedHours, 0)}h`,
            detail: "任务预估工时，不是 AI 运行时间",
            icon: Clock3,
          },
          {
            label: "逾期未完成",
            value: overdue,
            detail: `${state.members.length} 位成员 · ${depts.length} 个部门`,
            icon: AlertTriangle,
          },
          {
            label: "项目计划预算",
            value: `¥${budget.toLocaleString()}`,
            detail: "全部项目合计 · 非实际收支",
            icon: Wallet,
          },
        ].map((m) => (
          <div key={m.label}>
            <span>
              {m.label}
              <m.icon size={17} />
            </span>
            <strong>{m.value}</strong>
            <p>{m.detail}</p>
          </div>
        ))}
      </div>
      <div className="analytics-grid">
        <section className="analytics-panel">
          <header>
            <h2>部门工作量</h2>
            <span>未完成任务的预估工时</span>
          </header>
          <div className="department-chart">
            {depts.map((d) => (
              <button
                key={d.name}
                onClick={() => open({ type: "department", name: d.name })}
              >
                <span>{d.name}</span>
                <div className="chart-bar-track">
                  <i
                    className={d.color}
                    style={{ width: `${(d.hours / maxHours) * 100}%` }}
                  />
                </div>
                <b>{d.hours}h</b>
              </button>
            ))}
          </div>
          <footer>
            <span>
              <i />
              按计划工时统计
            </span>
            <span>点击部门查看明细</span>
          </footer>
        </section>
        <section className="analytics-panel">
          <header>
            <h2>任务状态分布</h2>
            <span>{tasks.length} 个任务</span>
          </header>
          <div className="status-distribution">
            <svg
              viewBox="0 0 180 180"
              role="img"
              aria-label={`完成率 ${rate}%`}
            >
              <circle
                cx="90"
                cy="90"
                r="66"
                fill="none"
                stroke="#edf0f2"
                strokeWidth="20"
              />
              {statuses.map((s, i) => {
                const n = tasks.filter((t) => t.status === s.key).length;
                const before = statuses
                  .slice(0, i)
                  .reduce(
                    (sum, v) =>
                      sum + tasks.filter((t) => t.status === v.key).length,
                    0,
                  );
                return (
                  <circle
                    key={s.key}
                    cx="90"
                    cy="90"
                    r="66"
                    fill="none"
                    stroke={s.color}
                    strokeWidth="20"
                    strokeDasharray={`${tasks.length ? (n / tasks.length) * 414.69 : 0} 414.69`}
                    strokeDashoffset={
                      tasks.length ? (-before / tasks.length) * 414.69 : 0
                    }
                    transform="rotate(-90 90 90)"
                  />
                );
              })}
              <text
                x="90"
                y="87"
                textAnchor="middle"
                fontSize="30"
                fill="#303740"
                fontWeight="600"
              >
                {rate}%
              </text>
              <text
                x="90"
                y="110"
                textAnchor="middle"
                fontSize="11"
                fill="#979da5"
              >
                任务完成率
              </text>
            </svg>
            <div>
              {statuses.map((s) => (
                <span key={s.key}>
                  <i style={{ background: s.color }} />
                  {s.label}
                  <b>{tasks.filter((t) => t.status === s.key).length}</b>
                </span>
              ))}
            </div>
          </div>
        </section>
        <section className="analytics-panel wide-panel">
          <header>
            <h2>员工容量与风险</h2>
            <span>已分配的未完成任务 / 计划可用工时</span>
          </header>
          <div className="capacity-report">
            {state.members.map((m) => {
              const l = memberLoad({ ...state, tasks }, m);
              return (
                <button
                  key={m.id}
                  onClick={() => open({ type: "member", id: m.id })}
                >
                  <Avatar member={m} />
                  <div>
                    <strong>
                      {m.name}
                      <span>{m.role}</span>
                    </strong>
                    <div className="progress-track">
                      <span
                        className={l.load > 100 ? "orange" : m.color}
                        style={{ width: `${Math.min(100, l.load)}%` }}
                      />
                    </div>
                  </div>
                  <span>
                    {l.hours} / {m.capacity}h
                  </span>
                  <b className={l.load > 100 ? "overdue" : ""}>
                    {m.availability === "paused"
                      ? "暂停接单"
                      : l.load > 100
                        ? "超出容量"
                        : l.load === 100
                          ? "已满载"
                          : "有余量"}
                  </b>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
