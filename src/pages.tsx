import { KnowledgeRetrieval } from "./rag-ui";
import { CancelGeneration, Sources } from "./runs-ui";
import type { Passage } from "../shared/retrieval.mjs";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowRight,
  ArrowUpRight,
  Plus,
  Sparkles,
  CalendarDays,
  Flag,
  Search,
  LayoutGrid,
  List,
  BookOpen,
  FileText,
  Send,
  LoaderCircle,
  Target,
  ArrowDownToLine,
  Trash2,
  Clock3,
  Zap,
} from "lucide-react";
import { useApp } from "./context";
import { Avatar, Empty, PageHeading, TaskRow } from "./components";
import {
  dateIn,
  dateLabel,
  now,
  uid,
  statusText,
  priorityText,
  type Task,
} from "./domain";
import { api, download } from "./store";
import { transitionError } from "../shared/task-policy.mjs";

export function Tasks() {
  const { state, open, update, notify } = useApp();
  const [project, setProject] = useState("all");
  const [view, setView] = useState<"board" | "list">("board");
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("all");
  const [dragOver, setDragOver] = useState("");
  const tasks = state.tasks.filter(
    (t) =>
      (project === "all" || t.projectId === project) &&
      (priority === "all" || t.priority === priority) &&
      t.title.toLowerCase().includes(query.toLowerCase()),
  );
  const move = (id: string, status: Task["status"]) => {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    const error = transitionError(task, status, state.tasks);
    if (error) {
      notify(error, true);
      return;
    }
    update(
      (s) => ({
        ...s,
        tasks: s.tasks.map((t) => (t.id === id ? { ...t, status } : t)),
      }),
      `任务状态更新为${statusText[status]}`,
    );
    notify(`已移至${statusText[status]}`);
  };
  return (
    <>
      <PageHeading
        eyebrow="ONE STEP AT A TIME"
        title="任务看板"
        description="每一步推进，都离目标更近一点。拖动卡片即可更新状态。"
        action={
          <button
            className="button primary"
            onClick={() => {
              if (!state.projects.length) {
                open({ type: "project-new" });
                return;
              }
              open({
                type: "task",
                projectId: project === "all" ? undefined : project,
              });
            }}
          >
            <Plus size={17} />
            添加任务
          </button>
        }
      />
      <div className="filter-toolbar">
        <div className="inline-controls">
          <select
            aria-label="筛选项目"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            <option value="all">全部项目</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <select
            aria-label="筛选优先级"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="all">全部优先级</option>
            {Object.entries(priorityText).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="inline-controls">
          <div className="search-field compact">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索任务..."
              aria-label="搜索任务"
            />
          </div>
          <div className="view-toggle">
            <button
              className={view === "board" ? "active" : ""}
              aria-label="看板视图"
              onClick={() => setView("board")}
            >
              <LayoutGrid size={17} />
            </button>
            <button
              className={view === "list" ? "active" : ""}
              aria-label="列表视图"
              onClick={() => setView("list")}
            >
              <List size={17} />
            </button>
          </div>
        </div>
      </div>
      {view === "list" ? (
        <div className="panel">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
          {!tasks.length && (
            <Empty
              title="没有符合条件的任务"
              description="试试其他筛选条件，或添加一个新任务。"
            />
          )}
        </div>
      ) : (
        <div className="kanban">
          {Object.entries(statusText).map(([key, label]) => (
            <section
              className={`kanban-column ${dragOver === key ? "drag-over" : ""}`}
              key={key}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(key);
              }}
              onDragLeave={() => setDragOver("")}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver("");
                move(
                  e.dataTransfer.getData("text/plain"),
                  key as Task["status"],
                );
              }}
            >
              <header>
                <span className={`column-dot ${key}`} />
                <h3>{label}</h3>
                <span className="column-count">
                  {tasks.filter((t) => t.status === key).length}
                </span>
                <button
                  className="icon-button"
                  aria-label={`在${label}添加任务`}
                  onClick={() =>
                    state.projects.length
                      ? open({
                          type: "task",
                          projectId: project === "all" ? undefined : project,
                        })
                      : open({ type: "project-new" })
                  }
                >
                  <Plus size={15} />
                </button>
              </header>
              <div className="kanban-cards">
                {tasks
                  .filter((t) => t.status === key)
                  .map((t) => {
                    const member = state.members.find(
                      (m) => m.id === t.ownerId,
                    );
                    const p = state.projects.find((p) => p.id === t.projectId);
                    return (
                      <article
                        key={t.id}
                        className="kanban-card"
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData("text/plain", t.id)
                        }
                      >
                        <button
                          className="kanban-card-content"
                          onClick={() => open({ type: "task", id: t.id })}
                        >
                          <div className="kanban-card-label">
                            <span className={`pill ${p?.color || "purple"}`}>
                              {p?.title}
                            </span>
                            <span
                              className={`priority-dot ${t.priority}`}
                              title={priorityText[t.priority]}
                            />
                          </div>
                          <h4>{t.title}</h4>
                          <p>{t.description}</p>
                          <div className="kanban-card-footer">
                            <span
                              className={
                                t.deadline < dateIn() && t.status !== "done"
                                  ? "overdue"
                                  : ""
                              }
                            >
                              <CalendarDays size={13} />
                              {dateLabel(t.deadline)}
                            </span>
                            <span>
                              <Avatar member={member} size="small" />
                              {member?.name || "未分配"}
                            </span>
                          </div>
                        </button>
                        <select
                          className="task-status-select"
                          aria-label={`更新${t.title}状态`}
                          value={t.status}
                          onChange={(e) =>
                            move(t.id, e.target.value as Task["status"])
                          }
                        >
                          {Object.entries(statusText).map(([v, text]) => (
                            <option key={v} value={v}>
                              {text}
                            </option>
                          ))}
                        </select>
                      </article>
                    );
                  })}
                {!tasks.some((t) => t.status === key) && (
                  <div className="column-empty">
                    {key === "done"
                      ? "每个完成，都值得记录"
                      : "将任务拖动到这里"}
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

export function KnowledgePage() {
  const { state, open, update, notify } = useApp();
  const [query, setQuery] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const importNote = async (f?: File) => {
    if (!f) return;
    if (!/\.(md|txt)$/i.test(f.name) || f.size > 200000) {
      notify("请选择 200 KB 以内的 Markdown 或 TXT 文件", true);
      return;
    }
    try {
      const content = await f.text();
      if (content.length > 100000)
        throw new Error("内容超过 10 万字符，请拆分后导入");
      update(
        (s) => ({
          ...s,
          knowledge: [
            {
              id: uid(),
              title: f.name.replace(/\.[^.]+$/, "").slice(0, 200),
              content,
              category: "资料",
              updatedAt: now(),
            },
            ...s.knowledge,
          ],
        }),
        `导入资料：${f.name.slice(0, 150)}`,
      );
      notify("资料已加入知识空间");
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  const notes = state.knowledge.filter((k) =>
    `${k.title} ${k.content}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="A HOME FOR YOUR KNOWLEDGE"
        title="知识空间"
        description="让经验留下来，让 AI 更懂你的背景与习惯。"
        action={
          <div className="inline-controls">
            <input
              type="file"
              ref={file}
              hidden
              accept=".md,.txt"
              onChange={(e) => {
                void importNote(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button className="button" onClick={() => file.current?.click()}>
              <ArrowDownToLine size={16} />
              导入资料
            </button>
            <button
              className="button primary"
              onClick={() => open({ type: "knowledge" })}
            >
              <Plus size={17} />
              新建笔记
            </button>
          </div>
        }
      />
      <div className="knowledge-banner">
        <BookOpen size={25} />
        <div>
          <strong>你的知识，是 AI 团队的共同背景</strong>
          <p>
            生成前先检索公共资料与所属项目资料，每次最多 6
            个相关片段。只有命中片段会发送给模型，执行记录中可核对来源。
          </p>
        </div>
      </div>
      <KnowledgeRetrieval />
      <div className="filter-toolbar">
        <span className="muted">共 {state.knowledge.length} 篇资料</span>
        <div className="search-field compact">
          <Search size={16} />
          <input
            placeholder="搜索知识..."
            aria-label="搜索知识"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="knowledge-grid">
        {notes.map((k) => (
          <button
            key={k.id}
            className="knowledge-card"
            onClick={() => open({ type: "knowledge", id: k.id })}
          >
            <div>
              <span className="knowledge-icon">
                <FileText size={23} />
              </span>
              <span className="pill neutral">
                {k.category} ·{" "}
                {k.projectId
                  ? state.projects.find((p) => p.id === k.projectId)?.title ||
                    "原项目资料"
                  : "公共"}
              </span>
            </div>
            <h3>{k.title}</h3>
            <p>{k.content.replace(/[#*`>]/g, "").slice(0, 150)}</p>
            <footer>
              <span>{new Date(k.updatedAt).toLocaleDateString("zh-CN")}</span>
              <ArrowUpRight size={16} />
            </footer>
          </button>
        ))}
      </div>
      {!notes.length && (
        <Empty
          icon={<BookOpen size={32} />}
          title="给知识一个安放的地方"
          description="保存你的个人背景、项目资料、写作风格或灵感。"
          action={
            <button
              className="button primary"
              onClick={() => open({ type: "knowledge" })}
            >
              <Plus size={16} />
              记录第一篇笔记
            </button>
          }
        />
      )}
    </>
  );
}

export function Assistant() {
  const { state, update, config, notify, navigate } = useApp();
  const [input, setInput] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const summary = () => {
    const todo = state.tasks.filter((t) => t.status !== "done");
    const overdue = todo.filter((t) => t.deadline < dateIn());
    const review = todo.filter((t) => t.status === "review");
    const next = [...todo]
      .sort((a, b) => a.deadline.localeCompare(b.deadline))
      .slice(0, 3);
    const content = `## 你的工作台简报\n\n*本地统计 · ${new Date().toLocaleDateString("zh-CN")} · 非 AI 生成*\n\n- **${state.projects.filter((p) => p.status === "active").length}** 个进行中的项目\n- **${todo.length}** 个待完成任务，其中 **${review.length}** 个待验收\n- **${overdue.length}** 个任务已超过计划日期\n\n### 按截止时间排序的待办\n${next.length ? next.map((t) => `- **${t.title}** · ${dateLabel(t.deadline)} · ${statusText[t.status]}`).join("\n") : "当前没有待办任务，可以开始一个新目标。"}\n\n${review.length ? "建议先查看待验收的成果，再安排下一轮任务。" : "建议选定一个最重要的任务，留出专注时间。"}`;
    update((s) => ({
      ...s,
      messages: [
        ...s.messages,
        { id: uid(), role: "assistant" as const, content, createdAt: now() },
      ].slice(-200),
    }));
  };
  const send = async (prompt = input) => {
    if (!prompt.trim() || busy) return;
    if (!config?.configured) {
      notify("请先配置 AI 模型，或使用本地简报", true);
      return;
    }
    const message = {
      id: uid(),
      role: "user" as const,
      content: prompt.trim(),
      createdAt: now(),
    };
    const history = [...state.messages, message].slice(-16);
    update((s) => ({ ...s, messages: [...s.messages, message].slice(-200) }));
    setInput("");
    setBusy(true);
    setTimeout(
      () => bottom.current?.scrollIntoView({ behavior: "smooth" }),
      50,
    );
    try {
      const context = JSON.stringify({
        profile: state.profile,
        projects: state.projects,
        tasks: state.tasks.map(
          ({ id, title, status, deadline, ownerId, projectId }) => ({
            id,
            title,
            status,
            deadline,
            ownerId,
            projectId,
          }),
        ),
        members: state.members.map(({ prompt: _prompt, ...m }) => m),
      }).slice(0, 40000);
      const { content, sources } = await api<{
        content: string;
        sources?: Passage[];
      }>("/chat", {
        projectId,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        context,
        knowledge: state.knowledge,
      });
      update((s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: uid(),
            role: "assistant" as const,
            content,
            sources,
            createdAt: now(),
          },
        ].slice(-200),
      }));
    } catch (e) {
      notify((e as Error).message, true);
      setInput(prompt);
    } finally {
      setBusy(false);
      setTimeout(
        () => bottom.current?.scrollIntoView({ behavior: "smooth" }),
        80,
      );
    }
  };
  return (
    <>
      <div className="assistant-scope">
        <label className="field">
          对话资料范围
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">公共知识</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} + 公共知识
              </option>
            ))}
          </select>
        </label>
        {busy && <CancelGeneration endpoint="/chat" />}
      </div>
      <PageHeading
        eyebrow="THINK CLEARLY, MOVE FORWARD"
        title="决策助手"
        description="梳理优先级、识别卡点，让每个决定更有依据。"
        action={
          <div className="inline-controls">
            <button className="button" onClick={summary}>
              <Zap size={16} />
              本地简报
            </button>
            <button
              className="icon-button"
              aria-label="导出对话"
              disabled={!state.messages.length}
              onClick={() =>
                download(
                  "决策助手对话.md",
                  state.messages
                    .map(
                      (m) =>
                        `## ${m.role === "user" ? "我" : "助手"}\n\n${m.content}`,
                    )
                    .join("\n\n---\n\n"),
                  "text/markdown",
                )
              }
            >
              <ArrowDownToLine size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="清空对话"
              disabled={busy || !state.messages.length}
              onClick={() => {
                if (
                  window.confirm("清空当前对话记录？此操作不会删除项目与任务。")
                )
                  update((s) => ({ ...s, messages: [] }));
              }}
            >
              <Trash2 size={17} />
            </button>
          </div>
        }
      />
      <div className="chat-panel">
        {!config?.configured && (
          <div className="chat-config-notice">
            <Sparkles size={16} />
            <span>连接模型后，助手会结合你的项目与知识资料提供建议。</span>
            <button onClick={() => navigate("settings")}>
              配置模型
              <ArrowRight size={13} />
            </button>
          </div>
        )}
        <div className="chat-messages">
          {!state.messages.length && (
            <div className="chat-welcome">
              <div className="chat-brand">
                <Sparkles size={33} />
              </div>
              <h2>想清楚，再向前。</h2>
              <p>你的目标、任务和团队，都是我们思考的起点。</p>
              <div className="chat-prompts">
                {[
                  { icon: Target, text: "帮我梳理今天的任务优先级" },
                  { icon: Flag, text: "目前有哪些项目风险需要关注？" },
                  { icon: Clock3, text: "如何合理安排我和 AI 员工的分工？" },
                ].map(({ icon: Icon, text }) => (
                  <button
                    key={text}
                    onClick={() =>
                      config?.configured ? void send(text) : setInput(text)
                    }
                  >
                    <Icon size={18} />
                    {text}
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {state.messages.map((m) => (
            <div key={m.id} className={`chat-message ${m.role}`}>
              <span className="chat-message-avatar">
                {m.role === "assistant" ? (
                  <Sparkles size={18} />
                ) : (
                  state.profile.name.slice(0, 1).toUpperCase()
                )}
              </span>
              <div>
                <span className="message-author">
                  {m.role === "assistant" ? "方舟决策助手" : state.profile.name}
                  <small>
                    {new Date(m.createdAt).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </span>
                <div className="markdown">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                  <Sources passages={m.sources} />
                </div>
              </div>
            </div>
          ))}
          {busy && (
            <div className="chat-thinking">
              <LoaderCircle className="spin" size={17} />
              正在结合你的工作台思考...
            </div>
          )}
          <div ref={bottom} />
        </div>
        <form
          className="chat-compose"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            aria-label="发送给决策助手"
            placeholder="说说你的想法，或提出一个问题..."
            value={input}
            maxLength={10000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div>
            <span>
              {config?.configured
                ? `${config.model} · 建议由你决策执行`
                : "离线模式 · 可先查看本地简报"}{" "}
              · Enter 发送
            </span>
            <button
              className="button primary"
              disabled={busy || !input.trim() || !config?.configured}
              type="submit"
              aria-label="发送消息"
            >
              {busy ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Send size={18} />
              )}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
