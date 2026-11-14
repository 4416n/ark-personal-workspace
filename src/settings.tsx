import { useEffect, useRef, useState, lazy, Suspense } from "react";
import {
  Check,
  Download,
  Upload,
  Sparkles,
  KeyRound,
  Eye,
  EyeOff,
  LoaderCircle,
  Trash2,
  HardDrive,
  UserRound,
  ExternalLink,
  ShieldCheck,
  CircleAlert,
} from "lucide-react";
import { useApp } from "./context";
import { Modal, PageHeading } from "./components";
import { dateIn, stateSchema, type AiConfig, type Workspace } from "./domain";
import { api, download } from "./store";
import { MobileConnection, BackupPanel } from "./connectivity";

const FullBackupPanel = lazy(() =>
  import("./backup-ui").then((m) => ({ default: m.FullBackupPanel })),
);
const EnvironmentPanel = lazy(() =>
  import("./environment-ui").then((m) => ({ default: m.EnvironmentPanel })),
);

const providers = [
  {
    name: "DeepSeek",
    url: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  {
    name: "通义千问",
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
  {
    name: "硅基流动",
    url: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen2.5-72B-Instruct",
  },
  { name: "自定义兼容接口", url: "", model: "" },
];
export function SettingsPage() {
  const { state, update, config, refreshConfig, notify, session } = useApp();
  const [profile, setProfile] = useState(state.profile);
  const [provider, setProvider] = useState("DeepSeek");
  const [baseUrl, setBaseUrl] = useState(providers[0].url);
  const [model, setModel] = useState(providers[0].model);
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [tested, setTested] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<Workspace | null>(null);
  useEffect(() => {
    if (config) {
      setProvider(config.provider);
      setBaseUrl(config.baseUrl);
      setModel(config.model);
    }
  }, [config]);
  const saveConfig = async (test = false) => {
    setBusy(test ? "test" : "save");
    setError("");
    setTested("");
    try {
      await api<AiConfig>("/config", {
        provider,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: key,
      });
      setKey("");
      await refreshConfig();
      if (test) {
        const r = await api<{ message: string }>("/test", {});
        setTested(r.message);
        notify("模型连接成功");
      } else notify("模型配置已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const readImport = async (f?: File) => {
    if (!f) return;
    if (f.size > 10000000) {
      notify("备份文件过大，请使用 10 MB 以内的 JSON 文件", true);
      return;
    }
    try {
      const data = stateSchema.parse(JSON.parse(await f.text()));
      setPendingImport(data);
    } catch {
      notify("备份格式不正确或关联数据不完整，现有数据未更改", true);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="MAKE IT YOURS"
        title="工作台设置"
        description="调整你的工作空间，让一切按照你的方式运转。"
      />
      <div className="settings-layout">
        <div className="settings-main">
          <MobileConnection />
          <BackupPanel />
          <Suspense fallback={<p className="field-hint">正在加载完整备份…</p>}>
            <FullBackupPanel />
          </Suspense>
          <section className="panel settings-section">
            <div className="settings-title">
              <span className="settings-icon purple">
                <UserRound size={20} />
              </span>
              <div>
                <h2>个人资料</h2>
                <p>给这个空间，添一点你的印记。</p>
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!profile.name.trim()) return;
                update((s) => ({
                  ...s,
                  profile: { ...profile, name: profile.name.trim() },
                }));
                notify("个人资料已保存");
              }}
            >
              <div className="form-grid">
                <label className="field">
                  你的名字
                  <input
                    required
                    maxLength={40}
                    value={profile.name}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                </label>
                <label className="field">
                  你的身份
                  <input
                    maxLength={60}
                    value={profile.role}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, role: e.target.value }))
                    }
                  />
                </label>
                <label className="field full">
                  送给自己的话
                  <input
                    maxLength={200}
                    value={profile.focus}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, focus: e.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="settings-form-footer">
                <button type="submit" className="button primary">
                  <Check size={16} />
                  保存资料
                </button>
              </div>
            </form>
          </section>
          <Suspense
            fallback={<p className="field-hint">正在加载工程环境检查…</p>}
          >
            <EnvironmentPanel />
          </Suspense>
          <section className="panel settings-section">
            <div className="settings-title">
              <span className="settings-icon purple">
                <Sparkles size={20} />
              </span>
              <div>
                <h2>连接 AI 模型</h2>
                <p>为目标拆解、任务创作与决策助手提供能力。</p>
              </div>
              <span
                className={`pill ${config?.configured ? "green" : "neutral"}`}
              >
                {config?.configured ? "已保存凭据" : "尚未配置"}
              </span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveConfig();
              }}
            >
              {!session?.local && (
                <p className="alert">
                  手机可以使用电脑已连接的模型；配置密钥请在电脑操作。
                </p>
              )}
              <fieldset
                className="settings-config-fields"
                disabled={!session?.local}
              >
                <div className="provider-tabs">
                  {providers.map((p) => (
                    <button
                      type="button"
                      key={p.name}
                      className={provider === p.name ? "active" : ""}
                      onClick={() => {
                        setProvider(p.name);
                        if (p.url) {
                          setBaseUrl(p.url);
                          setModel(p.model);
                        }
                        setKey("");
                        setTested("");
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
                <div className="form-grid">
                  <label className="field full">
                    API Base URL
                    <input
                      required
                      type="url"
                      value={baseUrl}
                      onChange={(e) => {
                        setBaseUrl(e.target.value);
                        setTested("");
                      }}
                      maxLength={500}
                      placeholder="https://api.example.com/v1"
                    />
                    <small>
                      填写兼容 Chat Completions 的接口前缀，不含
                      /chat/completions。
                    </small>
                  </label>
                  <label className="field full">
                    模型名称
                    <input
                      required
                      maxLength={150}
                      value={model}
                      onChange={(e) => {
                        setModel(e.target.value);
                        setTested("");
                      }}
                      placeholder="请输入服务商提供的模型 ID"
                    />
                  </label>
                  <label className="field full">
                    API Key
                    <div className="password-input">
                      <KeyRound size={16} />
                      <input
                        type={visible ? "text" : "password"}
                        value={key}
                        maxLength={2000}
                        onChange={(e) => {
                          setKey(e.target.value);
                          setTested("");
                        }}
                        autoComplete="new-password"
                        placeholder={
                          config?.configured
                            ? "已保存；同一地址下留空保留现有 Key"
                            : "粘贴你的 API Key"
                        }
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={visible ? "隐藏 API Key" : "显示 API Key"}
                        onClick={() => setVisible(!visible)}
                      >
                        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                    <small>
                      {session?.remote ? "密钥仅保存在服务器数据目录的 ai-config.json" : "密钥仅保存在本机 .local/ai-config.json"}，不写入浏览器存储或数据导出文件。
                    </small>
                  </label>
                </div>
                {error && (
                  <div className="alert error">
                    <CircleAlert size={16} />
                    {error}
                  </div>
                )}
                {tested && (
                  <div className="alert success">
                    <Check size={16} />
                    {tested}
                  </div>
                )}
                <div className="settings-form-footer split">
                  <button
                    className="text-button danger"
                    type="button"
                    disabled={!!busy || !config?.configured}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          "移除已保存的 API Key？离线规划和项目数据会保留。",
                        )
                      )
                        return;
                      setBusy("remove");
                      try {
                        await api("/config", undefined, "DELETE");
                        await refreshConfig();
                        setKey("");
                        setTested("");
                        notify("API Key 已移除");
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    <Trash2 size={14} />
                    移除密钥
                  </button>
                  <div className="inline-controls">
                    <button
                      type="button"
                      className="button"
                      disabled={!!busy || !baseUrl.trim() || !model.trim()}
                      onClick={() => void saveConfig(true)}
                    >
                      {busy === "test" ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <ShieldCheck size={16} />
                      )}
                      保存并测试连接
                    </button>
                    <button
                      type="submit"
                      className="button primary"
                      disabled={!!busy}
                    >
                      {busy === "save" && (
                        <LoaderCircle className="spin" size={16} />
                      )}
                      保存配置
                    </button>
                  </div>
                </div>
              </fieldset>
            </form>
          </section>
          <section className="panel settings-section">
            <div className="settings-title">
              <span className="settings-icon blue">
                <HardDrive size={20} />
              </span>
              <div>
                <h2>数据与备份</h2>
                <p>
                  {session?.shared
                    ? `数据保存在${session.remote ? "服务器" : "电脑"}，手机和电脑共享；也可导出独立文件留存。`
                    : "数据保存在当前浏览器，定期备份，让进展安心留存。"}
                </p>
              </div>
            </div>
            <div className="data-stats">
              <span>
                <strong>{state.projects.length}</strong>项目
              </span>
              <span>
                <strong>{state.tasks.length}</strong>任务
              </span>
              <span>
                <strong>{state.members.length}</strong>员工
              </span>
              <span>
                <strong>{state.knowledge.length}</strong>笔记
              </span>
            </div>
            <p className="field-hint">
              此 JSON
              仅包含项目、任务、笔记等业务数据；迁移源码与执行历史请使用上方「完整迁移备份」。
            </p>
            <div className="data-actions">
              <button
                className="button"
                onClick={() => {
                  download(
                    `方舟工作台备份-${dateIn()}.json`,
                    JSON.stringify(state, null, 2),
                  );
                  notify(
                    "业务数据已导出；不含工程源码、执行日志和模型配置密钥",
                  );
                }}
              >
                <Download size={16} />
                导出业务数据（JSON）
              </button>
              <button className="button" onClick={() => file.current?.click()}>
                <Upload size={16} />
                从备份恢复
              </button>
              <input
                type="file"
                aria-label="业务 JSON 文件"
                accept=".json,application/json"
                hidden
                ref={file}
                onChange={(e) => {
                  void readImport(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="data-reset-row">
              <div>
                <strong>清除示例项目</strong>
                <p>保留员工、个人配置与你创建的真实项目。</p>
              </div>
              <button
                className="button small-button"
                disabled={
                  !state.projects.some((p) => p.demo) &&
                  !state.tasks.some((t) => t.demo)
                }
                onClick={() => {
                  const ids = new Set(
                    state.projects.filter((p) => p.demo).map((p) => p.id),
                  );
                  const count = state.tasks.filter(
                    (t) => t.demo || ids.has(t.projectId),
                  ).length;
                  if (
                    window.confirm(
                      `清除 ${ids.size} 个示例项目及 ${count} 个关联任务？这些项目中新增的任务也会被清除。`,
                    )
                  ) {
                    update(
                      (s) => ({
                        ...s,
                        projects: s.projects.filter((p) => !p.demo),
                        tasks: s.tasks.filter(
                          (t) => !t.demo && !ids.has(t.projectId),
                        ),
                      }),
                      "已清除示例项目与关联任务",
                    );
                    notify("示例数据已清除，可以开始你的真实项目");
                  }
                }}
              >
                清除示例
              </button>
            </div>
            <div className="data-reset-row">
              <div>
                <strong>重置业务数据</strong>
                <p>删除全部项目、任务、笔记、对话和动态，保留员工与设置。</p>
              </div>
              <button
                className="text-button danger"
                onClick={() => {
                  if (
                    window.confirm(
                      "确认删除所有项目、任务、知识笔记、对话和动态？此操作无法撤销，请先导出备份。",
                    )
                  ) {
                    update((s) => ({
                      ...s,
                      projects: [],
                      tasks: [],
                      knowledge: [],
                      messages: [],
                      activity: [],
                    }));
                    notify("业务数据已重置");
                  }
                }}
              >
                重置数据
              </button>
            </div>
          </section>
        </div>
        <aside className="settings-aside">
          <div className="settings-help">
            <span className="settings-help-icon">
              <Sparkles size={24} />
            </span>
            <h3>三步，开始协作</h3>
            <ol>
              <li>
                <strong>选择模型服务</strong>
                <p>在服务商官网开通 API，取得自己的密钥。</p>
              </li>
              <li>
                <strong>保存并测试连接</strong>
                <p>
                  确认接口、模型名称和密钥可用。测试会发起一次小额模型请求。
                </p>
              </li>
              <li>
                <strong>交给团队第一项任务</strong>
                <p>新建目标并选择 AI 智能拆解，或打开任务生成交付物。</p>
              </li>
            </ol>
            <a
              href="https://platform.deepseek.com/"
              target="_blank"
              rel="noreferrer"
            >
              DeepSeek 开放平台
              <ExternalLink size={13} />
            </a>
            <a
              href="https://bailian.console.aliyun.com/"
              target="_blank"
              rel="noreferrer"
            >
              阿里云百炼
              <ExternalLink size={13} />
            </a>
          </div>
          <div className="local-note">
            <ShieldCheck size={21} />
            <h4>{session?.remote ? "属于你的私人工作台" : "属于你的本地空间"}</h4>
            <p>
              基础管理和离线规划无需 API Key。只有主动使用 AI
              功能时，相关目标与资料才会发给你配置的服务。
            </p>
            <p>
              共享模式下，不同设备读取{session?.remote ? "服务器" : "电脑"}上的同一份数据；视图偏好仍分别保存在各自浏览器。
            </p>
          </div>
        </aside>
      </div>
      {pendingImport && (
        <Modal
          title="确认恢复这份备份"
          subtitle="恢复后将替换当前浏览器中的工作台数据，API 配置保持不变。"
          onClose={() => setPendingImport(null)}
        >
          <div className="modal-body">
            <div className="import-preview">
              <strong>{pendingImport.profile.name} 的工作空间</strong>
              <p>
                {pendingImport.projects.length} 个项目 ·{" "}
                {pendingImport.tasks.length} 个任务 ·{" "}
                {pendingImport.members.length} 位员工 ·{" "}
                {pendingImport.knowledge.length} 篇笔记
              </p>
            </div>
            <p className="muted">
              建议先导出当前数据。备份内容已通过格式及关联完整性校验。
            </p>
            <button
              className="button"
              onClick={() =>
                download(
                  `方舟恢复前备份-${dateIn()}.json`,
                  JSON.stringify(state, null, 2),
                )
              }
            >
              <Download size={16} />
              先备份当前数据
            </button>
          </div>
          <footer className="modal-footer">
            <button className="button" onClick={() => setPendingImport(null)}>
              取消
            </button>
            <button
              className="button primary"
              onClick={() => {
                update(() => pendingImport);
                setProfile(pendingImport.profile);
                setPendingImport(null);
                notify("备份已恢复");
              }}
            >
              确认替换并恢复
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
