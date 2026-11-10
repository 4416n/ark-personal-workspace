import { useEffect, useState } from "react";
import { AutomationStrip } from "./automation-ui";
import {
  FolderKanban,
  ListTodo,
  Users,
  BookOpen,
  Sparkles,
  Settings,
  Search,
  Bell,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  Menu,
  X,
  CheckCheck,
  CircleAlert,
  Command,
  Building2,
  ClipboardCheck,
  ChartNoAxesCombined,
  Activity,
} from "lucide-react";
import { AppContext, type DialogState } from "./context";
import { api, download, useWorkspace } from "./store";
import { type AiConfig, type Page } from "./domain";
import { Logo, Modal } from "./components";
import { Tasks, KnowledgePage, Assistant } from "./pages";
import { Office } from "./office";
import { Organization } from "./organization";
import { Goals, Decisions, Analytics } from "./management";
import { SettingsPage } from "./settings";
import { Dialogs } from "./dialogs";
import { ConnectionGate } from "./connectivity";
import { RunsPage } from "./runs-ui";

const nav = [
  { id: "dashboard", label: "办公室", icon: Building2 },
  { id: "projects", label: "目标拆解", icon: FolderKanban },
  { id: "tasks", label: "任务看板", icon: ListTodo },
  { id: "decisions", label: "决策中心", icon: ClipboardCheck },
  { id: "analytics", label: "经营数据", icon: ChartNoAxesCombined },
  { id: "team", label: "团队", icon: Users },
  { id: "knowledge", label: "知识空间", icon: BookOpen },
  { id: "assistant", label: "决策助手", icon: Sparkles },
  { id: "runs", label: "AI 执行记录", icon: Activity },
] as const;
const validPages = [...nav.map((n) => n.id), "settings"];
function currentPage(): Page {
  const id = window.location.hash.slice(1);
  return (validPages.includes(id as Page) ? id : "dashboard") as Page;
}
export default function App() {
  const {
    state,
    update,
    storageError,
    recovery,
    ready,
    session,
    status,
    conflict,
    resolve,
    bootError,
    syncNow,
  } = useWorkspace();
  const [page, setPage] = useState<Page>(currentPage);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [toast, setToast] = useState<{
    text: string;
    error: boolean;
    id: number;
  } | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [activity, setActivity] = useState(false);
  const notify = (text: string, error = false) =>
    setToast({ text, error, id: Date.now() });
  const refreshConfig = async () => {
    try {
      setConfig(await api<AiConfig>("/config"));
    } catch {
      setConfig(null);
    }
  };
  const navigate = (id: Page) => {
    window.location.hash = id;
    setPage(id);
    setMobileNav(false);
    window.scrollTo(0, 0);
  };
  const openDialog = (next: DialogState) => {
    if (document.fullscreenElement) {
      void document
        .exitFullscreen()
        .then(() => setDialog(next))
        .catch(() => notify("请先退出全屏再打开详情", true));
    } else setDialog(next);
  };
  useEffect(() => {
    void refreshConfig();
    const handler = () => setPage(currentPage());
    const shortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearch("");
      }
    };
    window.addEventListener("hashchange", handler);
    document.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("hashchange", handler);
      document.removeEventListener("keydown", shortcut);
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const query = search?.trim().toLowerCase() || "";
  const results = query
    ? [
        ...state.projects
          .filter((p) => `${p.title} ${p.goal}`.toLowerCase().includes(query))
          .map((p) => ({
            title: p.title,
            kind: "项目",
            dialog: { type: "project", id: p.id } as DialogState,
          })),
        ...state.tasks
          .filter((t) =>
            `${t.title} ${t.description}`.toLowerCase().includes(query),
          )
          .map((t) => ({
            title: t.title,
            kind: "任务",
            dialog: { type: "task", id: t.id } as DialogState,
          })),
        ...state.members
          .filter((m) =>
            `${m.name} ${m.role} ${m.skills.join(" ")}`
              .toLowerCase()
              .includes(query),
          )
          .map((m) => ({
            title: `${m.name} · ${m.role}`,
            kind: "员工",
            dialog: { type: "member", id: m.id } as DialogState,
          })),
        ...state.knowledge
          .filter((k) =>
            `${k.title} ${k.content}`.toLowerCase().includes(query),
          )
          .map((k) => ({
            title: k.title,
            kind: "知识",
            dialog: { type: "knowledge", id: k.id } as DialogState,
          })),
      ].slice(0, 20)
    : [];
  if (!ready || !session?.authenticated)
    return (
      <ConnectionGate session={session} error={bootError} recovery={recovery} />
    );
  return (
    <AppContext.Provider
      value={{
        state,
        update,
        config,
        refreshConfig,
        navigate,
        open: openDialog,
        notify,
        session,
        syncNow,
      }}
    >
      <div className="app-shell">
        {mobileNav && (
          <button
            className="sidebar-scrim"
            aria-label="关闭导航"
            onClick={() => setMobileNav(false)}
          />
        )}
        <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
          <button className="brand" onClick={() => navigate("dashboard")}>
            <Logo />
            <div>
              <strong>
                BOSS<span>方舟</span>
              </strong>
              <small>个人 AI 决策工作台</small>
            </div>
          </button>
          <button
            className="workspace-switch"
            onClick={() => navigate("settings")}
          >
            <span className="workspace-letter">
              {state.profile.name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              {state.profile.name} 的工作空间<small>MY COMPANY</small>
            </span>
            <ChevronDown size={14} />
          </button>
          <p className="nav-caption">工作空间</p>
          <nav aria-label="主导航">
            {nav.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`nav-item ${page === id ? "active" : ""}`}
                aria-current={page === id ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                <Icon size={19} strokeWidth={1.7} />
                <span>{label}</span>
                {id === "tasks" &&
                  state.tasks.some((t) => t.status === "review") && (
                    <span className="nav-count">
                      {state.tasks.filter((t) => t.status === "review").length}
                    </span>
                  )}
                {id === "assistant" && <span className="ai-label">AI</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-tip">
              <span className="tip-icon">
                <Sparkles size={18} />
              </span>
              <h4>
                {config?.configured ? "模型配置已保存" : "连接你的 AI 团队"}
              </h4>
              <p>
                {config?.configured
                  ? `使用 ${config.model}，开始协作。`
                  : "连接 AI 模型，开启智能拆解与创作。"}
              </p>
              <button onClick={() => navigate("settings")}>
                {config?.configured ? "管理模型配置" : "配置 AI 模型"}
                <ArrowUpRight size={14} />
              </button>
            </div>
            <button
              className={`nav-item ${page === "settings" ? "active" : ""}`}
              onClick={() => navigate("settings")}
            >
              <Settings size={19} strokeWidth={1.7} />
              <span>工作台设置</span>
            </button>
            <button className="profile" onClick={() => navigate("settings")}>
              <span className="profile-avatar">
                {state.profile.name.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{state.profile.name}</strong>
                <small>{state.profile.role}</small>
              </span>
              <ChevronDown size={15} />
            </button>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-menu"
                aria-label="打开导航"
                onClick={() => setMobileNav(true)}
              >
                <Menu size={20} />
              </button>
              <span>我的公司</span>
              <ChevronRight size={13} />
              <strong>
                {page === "settings"
                  ? "工作台设置"
                  : nav.find((n) => n.id === page)?.label}
              </strong>
            </div>
            <div className="topbar-actions">
              <button className="global-search" onClick={() => setSearch("")}>
                <Search size={15} />
                <span>搜索任何内容...</span>
                <kbd>
                  <Command size={10} /> K
                </kbd>
              </button>
              <span className="topbar-divider" />
              <div className="activity-wrapper">
                <button
                  className="icon-button notification-button"
                  aria-label="查看工作台动态"
                  onClick={() => setActivity(!activity)}
                >
                  <Bell size={19} />
                  <i />
                </button>
                {activity && (
                  <div className="activity-popover">
                    <h4>
                      工作台动态
                      <button
                        className="icon-button"
                        aria-label="关闭动态"
                        onClick={() => setActivity(false)}
                      >
                        <X size={16} />
                      </button>
                    </h4>
                    {state.activity.slice(0, 6).map((a) => (
                      <p key={a.id}>
                        {a.text}
                        <small>{new Date(a.at).toLocaleString("zh-CN")}</small>
                      </p>
                    ))}
                    {!state.activity.length && <p>还没有新的动态</p>}
                  </div>
                )}
              </div>
              <button
                className="top-avatar"
                aria-label="编辑个人资料"
                onClick={() => navigate("settings")}
              >
                {state.profile.name.slice(0, 1).toUpperCase()}
              </button>
            </div>
          </header>
          <main className="page-content">
            <AutomationStrip />
            {session.shared && (
              <div
                className={`sync-status ${conflict || status.includes("中断") ? "attention" : ""}`}
              >
                <span>
                  <i />
                  {status}
                </span>
                {conflict && (
                  <div>
                    <button
                      onClick={() =>
                        download(
                          "方舟冲突本机备份.json",
                          JSON.stringify(state, null, 2),
                        )
                      }
                    >
                      先导出本机修改
                    </button>
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            "使用电脑最新版？本机未同步修改将被替换，建议先导出。",
                          )
                        )
                          resolve("remote");
                      }}
                    >
                      使用电脑最新版
                    </button>
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            "保留此设备版本并覆盖电脑对应数据？电脑当前版本会自动备份。",
                          )
                        )
                          resolve("local");
                      }}
                    >
                      保留此设备版本
                    </button>
                  </div>
                )}
              </div>
            )}
            {recovery && (
              <div className="alert error">
                检测到旧数据无法读取，原始内容已保留。请导出原始文件，再从设置恢复有效备份。
                <button
                  className="button"
                  onClick={() => download("方舟原始数据恢复.json", recovery)}
                >
                  导出原始数据
                </button>
              </div>
            )}
            {storageError && <div className="alert error">{storageError}</div>}
            {page === "dashboard" ? (
              <Office />
            ) : page === "projects" ? (
              <Goals />
            ) : page === "tasks" ? (
              <Tasks />
            ) : page === "team" ? (
              <Organization />
            ) : page === "decisions" ? (
              <Decisions />
            ) : page === "analytics" ? (
              <Analytics />
            ) : page === "knowledge" ? (
              <KnowledgePage />
            ) : page === "assistant" ? (
              <Assistant />
            ) : page === "runs" ? (
              <RunsPage />
            ) : (
              <SettingsPage />
            )}
          </main>
          <footer className="app-footer">
            <span>
              <i />
              {session.shared ? status : "浏览器独立模式"} ·{" "}
              {storageError ? "缓存异常" : "本地工作空间"}
            </span>
            <span>
              你来决策，团队来协作。
              <span className="footer-brand">BOSS WORKSPACE 3.2.1</span>
            </span>
          </footer>
        </div>
      </div>
      {dialog && <Dialogs dialog={dialog} close={() => setDialog(null)} />}
      {search !== null && (
        <Modal
          title="搜索工作空间"
          subtitle="项目、任务、员工和知识，都在这里。"
          onClose={() => setSearch(null)}
        >
          <div className="modal-body">
            <div className="search-field">
              <Search size={19} />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="输入关键词搜索..."
                aria-label="全局搜索"
              />
            </div>
            <div className="search-results">
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setSearch(null);
                    setDialog(r.dialog);
                  }}
                >
                  <span className="pill neutral">{r.kind}</span>
                  {r.title}
                  <ChevronRight size={15} />
                </button>
              ))}
              {query && !results.length && (
                <p>没有找到相关内容，试试其他关键词。</p>
              )}
              {!query && <p>试试搜索「知识库」或「小文」。</p>}
            </div>
          </div>
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleAlert size={18} /> : <CheckCheck size={18} />}
          <span>{toast.text}</span>
          <button aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}
