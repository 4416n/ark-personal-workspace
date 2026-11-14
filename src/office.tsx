import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Minus,
  Maximize2,
  RotateCcw,
  Sparkles,
  ChevronRight,
  Clock3,
  Target,
  Users,
  Coffee,
  BookOpen,
  CircleDot,
  Layers3,
  Monitor,
  ListTodo,
  Crown,
  Wifi,
  WifiOff,
  Crosshair,
  Rocket,
} from "lucide-react";
import { useApp } from "./context";
import { dateIn, dateLabel, projectProgress, type Member } from "./domain";
import {
  departmentNames,
  departmentStats,
  memberLoad,
  workspaceRisks,
} from "./insights";
import { Avatar } from "./components";
import { ActionQueue } from "./execution";
import { actionableTasks, taskReadiness } from "../shared/execution.mjs";
import { useOfficePreferences } from "./office-preferences";

const palette: Record<string, string> = {
  purple: "#8b80ca",
  blue: "#5c92c0",
  orange: "#d2a15b",
  green: "#69a994",
  pink: "#c486a4",
};
export function OfficePerson({
  color = "purple",
  boss = false,
}: {
  color?: string;
  boss?: boolean;
}) {
  return (
    <svg className="office-person" viewBox="0 0 56 66" aria-hidden="true">
      <ellipse cx="28" cy="61" rx="21" ry="4" fill="#32353715" />
      <path
        d="M8 53q0-17 20-17t20 17v7H8Z"
        fill={boss ? "#343944" : palette[color] || palette.purple}
      />
      <path d="m21 38 7 11 7-11" fill="#faf8f4" />
      <path d="m27 44-3 11 4 5 4-5-3-11" fill={boss ? "#bca576" : "#404953"} />
      <ellipse cx="28" cy="26" rx="15" ry="18" fill="#f0d6bc" />
      <path d="M12 27C5 3 41-6 46 18v15l-6-12-5-9-4 9-16-3Z" fill="#30323a" />
      <path
        d="M15 31v10M41 31v10"
        stroke="#30323a"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <g fill="none" stroke="#45454b" strokeWidth="1.5">
        <rect x="16" y="24" width="9" height="6" rx="2" />
        <rect x="31" y="24" width="9" height="6" rx="2" />
        <path d="M25 26h6" />
      </g>
      <path
        d="M25 35q3 3 6 0"
        fill="none"
        stroke="#bf9585"
        strokeLinecap="round"
      />
    </svg>
  );
}
function Plant({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`office-plant ${className}`}
      viewBox="0 0 45 57"
      aria-hidden="true"
    >
      <ellipse cx="23" cy="52" rx="16" ry="4" fill="#43584a18" />
      <path d="m13 32 4 20h13l4-20Z" fill="#dedcd3" />
      <ellipse cx="23" cy="32" rx="11" ry="4" fill="#9baba0" />
      <path d="M23 38V16" stroke="#6b8d67" strokeWidth="2" />
      <ellipse
        cx="15"
        cy="18"
        rx="6"
        ry="12"
        fill="#79a280"
        transform="rotate(-38 15 18)"
      />
      <ellipse
        cx="30"
        cy="17"
        rx="6"
        ry="12"
        fill="#91b191"
        transform="rotate(34 30 17)"
      />
      <ellipse
        cx="13"
        cy="28"
        rx="6"
        ry="10"
        fill="#9bbc99"
        transform="rotate(-62 13 28)"
      />
      <ellipse
        cx="32"
        cy="27"
        rx="6"
        ry="10"
        fill="#6d967a"
        transform="rotate(53 32 27)"
      />
    </svg>
  );
}
function Desk({
  member,
  mode,
  projectId = "",
}: {
  member?: Member;
  mode: string;
  projectId?: string;
}) {
  const { state, open } = useApp();
  const scoped = projectId
    ? { ...state, tasks: state.tasks.filter((t) => t.projectId === projectId) }
    : state;
  const info = member ? memberLoad(scoped, member) : null;
  const assigned = scoped.tasks.filter((t) => t.ownerId === member?.id);
  const signals =
    info?.tasks.map((task) =>
      taskReadiness(task, state.tasks, state.members, state.projects),
    ) || [];
  const signal = [
    "review",
    "doing",
    "ready",
    "blocked",
    "unassigned",
    "project-paused",
    "project-closed",
  ].flatMap((kind) => signals.filter((s) => s.kind === kind))[0];
  const deskStatus =
    member?.availability === "paused"
      ? "member-paused"
      : signal?.kind || "idle";
  const statusLabel =
    member?.availability === "paused"
      ? "暂停接单"
      : signal?.label || "暂无待办";
  return (
    <button
      className={`desk desk-state-${deskStatus} ${member ? "" : "empty-desk"} ${projectId && !assigned.length ? "outside-focus" : ""}`}
      aria-label={member ? `查看${member.name}的工作面板` : "招募新员工"}
      title={
        member
          ? `${member.name} · ${member.role}\n${statusLabel} · ${info?.hours}/${member.capacity}h\n${
              info?.tasks
                .slice(0, 3)
                .map((t) => t.title)
                .join("\n") || "当前没有待办"
            }`
          : "添加 AI 员工或真实成员"
      }
      onClick={() =>
        open(
          member ? { type: "staff-work", id: member.id } : { type: "member" },
        )
      }
    >
      <span className="desk-name">
        {member?.name || "虚位以待"}
        {member && <i className={deskStatus} />}
      </span>
      <span className="desk-illustration">
        <svg
          className="desk-furniture"
          viewBox="0 0 136 105"
          aria-hidden="true"
        >
          <ellipse cx="68" cy="91" rx="47" ry="9" fill="#43515d0d" />
          <rect x="47" y="31" width="44" height="52" rx="15" fill="#d6dadc" />
          <rect x="51" y="35" width="36" height="43" rx="12" fill="#e5e7e8" />
          <path
            d="M66 78v19m-17 1 19-4 18 4"
            stroke="#bac2c7"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path d="M16 70v20m104-20v20" stroke="#cfd5d9" strokeWidth="4" />
          <rect x="9" y="59" width="118" height="28" rx="5" fill="#d8dddf" />
          <rect x="9" y="56" width="118" height="25" rx="5" fill="#fafbfc" />
          <path d="M16 79h103" stroke="#eef0f1" />
          <rect x="37" y="52" width="54" height="5" rx="2" fill="#c8d0d6" />
          <rect x="43" y="38" width="44" height="22" rx="3" fill="#525d6a" />
          <rect
            x="46"
            y="40"
            width="38"
            height="17"
            rx="1"
            fill={member ? "#abc8d3" : "#d4dce1"}
          />
          <path
            d="M49 45h14m-14 4h24m-24 4h17"
            stroke="#edf4f6"
            strokeWidth="1.5"
            opacity=".8"
          />
          <rect x="50" y="65" width="29" height="7" rx="2" fill="#e4e9ed" />
          <path d="M54 67h21m-21 2h21" stroke="#cbd3da" strokeWidth="1" />
          <rect x="98" y="65" width="9" height="5" rx="2" fill="#e1e7ea" />
          <ellipse cx="25" cy="64" rx="5" ry="2.5" fill="#c7d8ce" />
          <path d="M20 63v7q5 4 10 0v-7" fill="#c7d8ce" />
          <path
            d="M30 65q5 0 3 4h-3"
            fill="none"
            stroke="#a7c0b3"
            strokeWidth="1.5"
          />
        </svg>
        {member && <OfficePerson color={member.color} />}
      </span>
      <span
        className={`desk-task-badge ${member?.availability === "paused" ? "is-paused" : ""}`}
      >
        {!member ? (
          <>
            <Plus size={10} />
            加入团队
          </>
        ) : member.availability === "paused" ? (
          "暂停接单"
        ) : mode === "load" ? (
          `${info?.hours}h / ${member.capacity}h`
        ) : mode === "skills" ? (
          member.skills.slice(0, 2).join(" · ")
        ) : info?.tasks.length ? (
          `${info.tasks.length} 项待办 · ${statusLabel}`
        ) : (
          "可安排任务"
        )}
      </span>
    </button>
  );
}
function DepartmentRoom({
  name,
  mode,
  index,
  projectId = "",
}: {
  name: string;
  mode: string;
  index: number;
  projectId?: string;
}) {
  const { state, open } = useApp();
  const d = departmentStats(
    projectId
      ? {
          ...state,
          tasks: state.tasks.filter((t) => t.projectId === projectId),
        }
      : state,
    name,
  );
  const blocked = d.active.filter((t) =>
    ["blocked", "member-paused", "project-paused", "project-closed"].includes(
      taskReadiness(t, state.tasks, state.members, state.projects).kind,
    ),
  ).length;
  const progress = d.tasks.length
    ? Math.round((d.done / d.tasks.length) * 100)
    : 0;
  return (
    <section
      className={`office-room department-room room-${index} room-tone-${d.color} ${projectId && !d.tasks.length ? "outside-focus" : projectId ? "within-focus" : ""}`}
    >
      <button
        className="room-heading"
        onClick={() => open({ type: "department", name })}
      >
        <i style={{ background: palette[d.color] }} />
        <strong>{name}</strong>
        <span>{d.members.length} 人</span>
        <ArrowUpRight size={12} />
      </button>
      <div className="room-subline">
        <span>
          {mode === "load"
            ? `计划负载 ${d.load}%`
            : mode === "skills"
              ? [...new Set(d.members.flatMap((m) => m.skills))]
                  .slice(0, 2)
                  .join(" / ")
              : `${d.active.length} 项推进中`}
        </span>
        {d.overdue > 0 ? (
          <b className="overdue">{d.overdue} 项逾期</b>
        ) : d.review > 0 ? (
          <b>{d.review} 项待验收</b>
        ) : (
          <span className={blocked ? "room-blocked" : "room-ready"}>
            {blocked
              ? `${blocked} 项待解除阻塞`
              : d.active.length
                ? "可继续推进"
                : "暂无待办"}
          </span>
        )}
      </div>
      <div className="room-desks">
        {d.members.slice(0, index === 2 ? 4 : 2).map((m) => (
          <Desk key={m.id} member={m} mode={mode} projectId={projectId} />
        ))}
        {d.members.length < 2 && <Desk mode={mode} projectId={projectId} />}
      </div>
      <div className="room-progress">
        <span
          style={{
            width: `${mode === "load" ? Math.min(d.load, 100) : progress}%`,
            background: palette[d.color],
          }}
        />
      </div>
      <Plant />
      {d.members.length > (index === 2 ? 4 : 2) && (
        <button
          className="more-seats"
          onClick={() => open({ type: "department", name })}
        >
          +{d.members.length - (index === 2 ? 4 : 2)} 位成员
        </button>
      )}
    </section>
  );
}
function BossRoom() {
  const { state, navigate, open } = useApp();
  const done = state.tasks.filter((t) => t.status === "done").length;
  const progress = state.tasks.length
    ? Math.round((done / state.tasks.length) * 100)
    : 0;
  return (
    <section className="office-room boss-room">
      <div className="boss-room-heading">
        <span>
          <Crown size={13} />
          决策办公室
        </span>
        <small>{state.profile.name} · BOSS</small>
        <span className="boss-key">核心指挥区</span>
      </div>
      <div className="ceo-art">
        <div className="office-board">
          <div>
            <span>本期执行进度</span>
            <strong>
              {progress}
              <small>%</small>
            </strong>
            <p>
              {done} / {state.tasks.length} 个任务已完成
            </p>
          </div>
          <svg viewBox="0 0 68 68" aria-hidden="true">
            <circle
              cx="34"
              cy="34"
              r="25"
              fill="none"
              stroke="#ffffff20"
              strokeWidth="5"
            />
            <circle
              cx="34"
              cy="34"
              r="25"
              fill="none"
              stroke="#a9cbb3"
              strokeWidth="5"
              strokeDasharray={`${progress * 1.57} 157`}
              transform="rotate(-90 34 34)"
            />
          </svg>
        </div>
        <div className="wall-clock">
          <i />
        </div>
        <div className="certificate">
          <Crown size={13} />
          <span>BOSS</span>
        </div>
        <div className="ceo-rug" />
        <div className="ceo-chair" />
        <OfficePerson boss />
        <div className="ceo-desk">
          <span className="ceo-laptop">
            <i />
          </span>
          <span className="ceo-notepad" />
          <span className="ceo-coffee" />
          <span className="ceo-nameplate">{state.profile.name}</span>
        </div>
        <div className="office-cabinet">
          <i />
          <i />
          <i />
          <i />
        </div>
        <Plant className="boss-plant" />
        <div className="office-sofa">
          <i />
          <i />
        </div>
      </div>
      <div className="boss-room-actions">
        <button onClick={() => open({ type: "project-new" })}>
          <Plus size={12} />
          下达新目标
        </button>
        <button onClick={() => navigate("decisions")}>
          处理决策
          <ChevronRight size={12} />
        </button>
      </div>
    </section>
  );
}
export function Office() {
  const { state, navigate, open, config, notify } = useApp();
  const [preferences, setPreferences] = useOfficePreferences();
  const { mode, zoom, view } = preferences;
  const setMode = (mode: string) => setPreferences({ mode });
  const setView = (view: string) => setPreferences({ view });
  const setZoom = (value: number | ((v: number) => number)) =>
    setPreferences({ zoom: typeof value === "number" ? value : value(zoom) });
  const projectId = state.projects.some((p) => p.id === preferences.projectId)
    ? preferences.projectId
    : "";
  const focusedTasks = state.tasks.filter(
    (t) => !projectId || t.projectId === projectId,
  );
  const focusedMembers = state.members.filter((m) =>
    focusedTasks.some((t) => t.ownerId === m.id),
  );
  const nextAction = actionableTasks(state, dateIn(), projectId)[0];
  const sceneRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sceneWidth, setSceneWidth] = useState(760);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const resize = () => setSceneWidth(Math.max(760, el.clientWidth));
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    return () => observer.disconnect();
  }, [view]);
  const names = departmentNames(state);
  const risks = workspaceRisks(state);
  const today = state.tasks.filter(
    (t) => t.status !== "done" && t.deadline <= dateIn(),
  );
  const active = state.projects.filter((p) => p.status === "active");
  const review = state.tasks.filter((t) => t.status === "review");
  const done = state.tasks.filter((t) => t.status === "done");
  const working = state.members.filter((m) => m.availability !== "paused");
  return (
    <div className="office-page">
      <div className="office-topline">
        <div>
          <span className="office-eyebrow">MY COMPANY / 我的公司</span>
          <h1>
            {state.profile.name} 的一人公司 <span>个人版</span>
          </h1>
          <p>目标由你决定，执行各有分工。</p>
        </div>
        <div className="office-top-actions">
          <span className="model-connection">
            {config?.configured ? <Wifi size={13} /> : <WifiOff size={13} />}{" "}
            {config?.configured ? config.model : "离线规划模式"}
          </span>
          <button
            className="button"
            onClick={() => navigate("autopilot")}
          ><Rocket size={15} />全自动交付</button>
          <button
            className="button primary"
            onClick={() => open({ type: "project-new" })}
          >
            <Sparkles size={15} />
            拆解新目标
          </button>
        </div>
      </div>
      <div className="office-layout">
        <div className="office-main">
          <div className="company-stats">
            {[
              {
                label: "进行中目标",
                value: active.length,
                icon: Target,
                page: "projects" as const,
                detail: `${state.projects.length} 个目标总计`,
              },
              {
                label: "待完成任务",
                value: state.tasks.length - done.length,
                icon: ListTodo,
                page: "tasks" as const,
                detail: `${done.length} 项已完成`,
              },
              {
                label: "团队成员",
                value: state.members.length,
                icon: Users,
                page: "team" as const,
                detail: `${names.length} 个部门 · ${working.length} 位可接单`,
              },
              {
                label: "待你决策",
                value: risks.length,
                icon: CircleDot,
                page: "decisions" as const,
                detail: `${review.length} 份成果待验收`,
              },
            ].map((m) => (
              <button key={m.label} onClick={() => navigate(m.page)}>
                <span>
                  <m.icon size={15} />
                  {m.label}
                </span>
                <div>
                  <strong>{String(m.value).padStart(2, "0")}</strong>
                  <small>{m.detail}</small>
                </div>
              </button>
            ))}
          </div>
          {nextAction && (
            <button
              className="next-action-bar"
              title="本地规则建议：优先验收，其次结合逾期、任务状态、优先级与截止日期排序。"
              onClick={() => open({ type: "task", id: nextAction.task.id })}
            >
              <span>
                <span className="next-action-mark">
                  <Sparkles size={14} />
                </span>
                <b>建议下一步</b>
              </span>
              <strong>{nextAction.task.title}</strong>
              <small>{nextAction.signal.label}</small>
              <ArrowRight size={15} />
            </button>
          )}
          <div className="office-canvas-shell" ref={sceneRef}>
            <div className="canvas-toolbar">
              <div className="canvas-title">
                <span className="live-indicator" />
                办公室<span>组织全景</span>
              </div>
              <div className="canvas-view-switch">
                <button
                  className={view === "office" ? "active" : ""}
                  onClick={() => setView("office")}
                >
                  <Monitor size={13} />
                  空间
                </button>
                <button
                  className={view === "departments" ? "active" : ""}
                  onClick={() => setView("departments")}
                >
                  <Layers3 size={13} />
                  部门
                </button>
              </div>
              <div className="canvas-tools" hidden={view !== "office"}>
                <button
                  aria-label="缩小办公室"
                  disabled={zoom <= 0.85}
                  onClick={() =>
                    setZoom((v) => Math.max(0.85, +(v - 0.1).toFixed(2)))
                  }
                >
                  <Minus size={14} />
                </button>
                <span>{Math.round(zoom * 100)}%</span>
                <button
                  aria-label="放大办公室"
                  disabled={zoom >= 1.3}
                  onClick={() =>
                    setZoom((v) => Math.min(1.3, +(v + 0.1).toFixed(2)))
                  }
                >
                  <Plus size={14} />
                </button>
                <button aria-label="重置办公室缩放" onClick={() => setZoom(1)}>
                  <RotateCcw size={13} />
                </button>
                <button
                  aria-label="全屏查看办公室"
                  onClick={async () => {
                    try {
                      if (document.fullscreenElement)
                        await document.exitFullscreen();
                      else await sceneRef.current?.requestFullscreen();
                    } catch {
                      notify("当前浏览器不支持全屏模式", true);
                    }
                  }}
                >
                  <Maximize2 size={14} />
                </button>
              </div>
            </div>
            <div className="office-focusbar">
              <label>
                <Crosshair size={14} />
                <span>项目聚焦</span>
                <select
                  aria-label="办公室聚焦项目"
                  value={projectId}
                  onChange={(e) =>
                    setPreferences({ projectId: e.target.value })
                  }
                >
                  <option value="">全部项目</option>
                  {state.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                      {p.status === "paused"
                        ? "（暂停）"
                        : p.status === "done"
                          ? "（已结束）"
                          : ""}
                    </option>
                  ))}
                </select>
              </label>
              <span>
                {projectId ? (
                  <>
                    {focusedTasks.length} 项任务 · {focusedMembers.length}{" "}
                    位参与成员
                  </>
                ) : (
                  "点击工位，查看分工与交付物"
                )}
              </span>
              {projectId && (
                <button onClick={() => setPreferences({ projectId: "" })}>
                  清除聚焦
                </button>
              )}
            </div>
            {view === "office" ? (
              <div className="office-scroll" ref={scrollRef}>
                <div
                  className="office-floor"
                  style={{ zoom, width: sceneWidth, minWidth: sceneWidth }}
                >
                  <div className="floor-top-label">
                    ARK HEADQUARTERS{" "}
                    <span>EST. {new Date().getFullYear()}</span>
                  </div>
                  <div className="floor-plan">
                    {names.slice(0, 3).map((name, index) => (
                      <DepartmentRoom
                        key={name}
                        name={name}
                        index={index}
                        mode={mode}
                        projectId={projectId}
                      />
                    ))}
                    {names.length < 3 &&
                      Array.from({ length: 3 - names.length }, (_, i) => (
                        <button
                          key={`empty-${i}`}
                          className={`office-room vacant-room room-${names.length + i}`}
                          onClick={() => navigate("team")}
                        >
                          <Plus size={22} />
                          <strong>开设新部门</strong>
                          <span>添加伙伴，拓展你的能力</span>
                        </button>
                      ))}
                    {names[3] ? (
                      <DepartmentRoom
                        name={names[3]}
                        index={3}
                        mode={mode}
                        projectId={projectId}
                      />
                    ) : (
                      <button
                        className="office-room vacant-room room-3"
                        onClick={() => open({ type: "member" })}
                      >
                        <Plus size={23} />
                        招募 AI 员工
                      </button>
                    )}
                    <BossRoom />
                    <button
                      className="office-room library-room"
                      onClick={() => navigate("knowledge")}
                    >
                      <div className="amenity-heading">
                        <BookOpen size={13} />
                        <strong>知识档案室</strong>
                        <span>{state.knowledge.length} 份</span>
                      </div>
                      <div className="bookshelf">
                        {Array.from({ length: 14 }, (_, i) => (
                          <i
                            key={i}
                            style={{
                              height: `${21 + (i % 4) * 6}px`,
                              background: [
                                "#a8bba8",
                                "#b8b0c8",
                                "#d6c5a5",
                                "#90aebb",
                                "#c5b1a7",
                              ][i % 5],
                            }}
                          />
                        ))}
                      </div>
                      <div className="archive-table">
                        <span />
                        <span />
                      </div>
                      <p>
                        团队的共同知识背景
                        <ArrowUpRight size={12} />
                      </p>
                      <Plant />
                    </button>
                    <button
                      className="office-room meeting-room"
                      onClick={() => navigate("assistant")}
                    >
                      <div className="amenity-heading">
                        <Users size={13} />
                        <strong>战略会议室</strong>
                        <span>AI 决策助手</span>
                      </div>
                      <div className="meeting-scene">
                        <div className="meeting-board">
                          <Sparkles size={12} />
                          下一步，应该先做什么？
                        </div>
                        <div className="meeting-table">
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                          <span>ARK</span>
                        </div>
                      </div>
                      <p>
                        结合项目与资料，讨论下一步
                        <ArrowUpRight size={12} />
                      </p>
                    </button>
                    <button
                      className="office-room lounge-room"
                      onClick={() => navigate("analytics")}
                    >
                      <div className="amenity-heading">
                        <Coffee size={13} />
                        <strong>复盘角</strong>
                        <span>经营数据</span>
                      </div>
                      <div className="lounge-sofa">
                        <i />
                        <i />
                      </div>
                      <div className="lounge-table">
                        <Coffee size={16} />
                      </div>
                      <Plant />
                      <p>
                        看看这一阶段的进展
                        <ArrowUpRight size={12} />
                      </p>
                    </button>
                  </div>
                  {names.length > 4 && (
                    <div className="extra-rooms">
                      {names.slice(4).map((name, index) => (
                        <DepartmentRoom
                          key={name}
                          name={name}
                          index={index + 4}
                          mode={mode}
                          projectId={projectId}
                        />
                      ))}
                    </div>
                  )}
                  <div className="floor-entrance">
                    <span />
                    <i>入口 / WELCOME TO YOUR COMPANY</i>
                    <span />
                  </div>
                </div>
              </div>
            ) : (
              <div className="department-overview-grid">
                {names.map((name) => {
                  const d = departmentStats(
                    { ...state, tasks: focusedTasks },
                    name,
                  );
                  return (
                    <button
                      key={name}
                      className={
                        projectId && !d.tasks.length ? "outside-focus" : ""
                      }
                      onClick={() => open({ type: "department", name })}
                    >
                      <span className={`dept-symbol ${d.color}`}>
                        <Users size={20} />
                      </span>
                      <h3>
                        {name}
                        <ArrowUpRight size={15} />
                      </h3>
                      <p>
                        {state.departments.find((x) => x.name === name)
                          ?.mission ||
                          d.members
                            .flatMap((m) => m.skills)
                            .slice(0, 4)
                            .join(" · ")}
                      </p>
                      <div className="dept-overview-numbers">
                        <span>
                          <b>{d.members.length}</b>位成员
                        </span>
                        <span>
                          <b>{d.active.length}</b>项任务
                        </span>
                        <span>
                          <b>{d.load}%</b>负载
                        </span>
                      </div>
                      <div className="progress-track">
                        <span
                          className={d.color}
                          style={{ width: `${Math.min(d.load, 100)}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
                {!names.length && <p>团队还没有部门，先添加一位员工。</p>}
              </div>
            )}
            <div className="canvas-bottom">
              <div className="office-mode-tabs" hidden={view !== "office"}>
                {[
                  { id: "daily", text: "日常", icon: Monitor },
                  { id: "load", text: "负载", icon: Clock3 },
                  { id: "skills", text: "能力", icon: Sparkles },
                ].map((m) => (
                  <button
                    key={m.id}
                    className={mode === m.id ? "active" : ""}
                    onClick={() => setMode(m.id)}
                  >
                    <m.icon size={12} />
                    {m.text}
                  </button>
                ))}
              </div>
              <span className="canvas-hint">
                {view === "office"
                  ? "点击工位查看员工 · 点击部门查看任务"
                  : "点击部门卡片，查看员工与任务"}
              </span>
              <span className="map-legend" hidden={view !== "office"}>
                <i />
                可接单
                <b />
                待验收
              </span>
            </div>
          </div>
          <section className="office-goals">
            <div className="office-section-title">
              <h2>
                目标推进 <small>{active.length} 项进行中</small>
              </h2>
              <button onClick={() => navigate("projects")}>
                全部目标
                <ArrowUpRight size={13} />
              </button>
            </div>
            <div className="office-goal-strip">
              {active.slice(0, 3).map((p) => {
                const progress = projectProgress(p, state.tasks);
                const tasks = state.tasks.filter((t) => t.projectId === p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => open({ type: "project", id: p.id })}
                  >
                    <div>
                      <span className={`tiny-label ${p.color}`}>
                        {p.demo ? "示例目标" : "进行中"}
                      </span>
                      <span>{dateLabel(p.deadline)} 截止</span>
                    </div>
                    <h3>{p.title}</h3>
                    <div className="goal-bottom">
                      <div className="progress-track">
                        <span
                          className={p.color}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <strong>{progress}%</strong>
                    </div>
                    <p>
                      {tasks.filter((t) => t.status === "done").length}/
                      {tasks.length} 个任务已完成
                      <ArrowRight size={12} />
                    </p>
                  </button>
                );
              })}
              {!active.length && (
                <button
                  className="empty-goal"
                  onClick={() => open({ type: "project-new" })}
                >
                  <Plus size={23} />
                  <h3>下达第一个目标</h3>
                  <p>让你的公司开始运转</p>
                </button>
              )}
            </div>
          </section>
        </div>
        <aside className="boss-briefing">
          <div className="briefing-tabs">
            <span>今日简报</span>
            <button onClick={() => navigate("analytics")}>
              经营总览
              <ArrowUpRight size={12} />
            </button>
          </div>
          <div className="briefing-date">
            <span>
              {new Date().toLocaleDateString("zh-CN", {
                year: "numeric",
                month: "long",
              })}
            </span>
            <h2>
              {new Date().getDate()}
              <span>
                {new Date().toLocaleDateString("zh-CN", { weekday: "long" })}
              </span>
            </h2>
            <p>
              {state.projects.some((p) => p.demo)
                ? "当前包含示例数据，可在设置中清除"
                : "你的工作台，实时汇总当前进展"}
            </p>
          </div>
          <div className="daily-numbers">
            <span>
              <b>{today.length}</b>今日待办
            </span>
            <span>
              <b>{review.length}</b>等待验收
            </span>
            <span>
              <b>{risks.filter((r) => r.kind === "overdue").length}</b>逾期任务
            </span>
          </div>
          <ActionQueue key={projectId} projectId={projectId} />
          <section className="brief-section">
            <div className="office-section-title">
              <h2>团队负载</h2>
              <button onClick={() => navigate("team")}>
                分工
                <ArrowUpRight size={12} />
              </button>
            </div>
            {state.members.slice(0, 5).map((m) => {
              const d = memberLoad(state, m);
              return (
                <button
                  className="brief-member"
                  key={m.id}
                  onClick={() => open({ type: "staff-work", id: m.id })}
                >
                  <Avatar member={m} size="small" />
                  <span>
                    <strong>
                      {m.name}
                      <small>{m.role}</small>
                    </strong>
                    <div className="progress-track">
                      <span
                        className={m.color}
                        style={{ width: `${Math.min(d.load, 100)}%` }}
                      />
                    </div>
                  </span>
                  <b className={d.load > 100 ? "overdue" : ""}>
                    {m.availability === "paused" ? "暂停" : `${d.load}%`}
                  </b>
                </button>
              );
            })}
          </section>
          <section className="brief-section briefing-log">
            <div className="office-section-title">
              <h2>最近动态</h2>
              <span>工作记录</span>
            </div>
            {state.activity.slice(0, 3).map((a) => (
              <div className="brief-log-item" key={a.id}>
                <i />
                <p>
                  {a.text}
                  <small>
                    {new Date(a.at).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </p>
              </div>
            ))}
          </section>
          <button
            className="brief-assistant"
            onClick={() => navigate("assistant")}
          >
            <span>
              <Sparkles size={19} />
            </span>
            <div>
              <strong>和决策助手聊聊</strong>
              <small>从当前进展，找到下一步</small>
            </div>
            <ArrowUpRight size={16} />
          </button>
        </aside>
      </div>
    </div>
  );
}
