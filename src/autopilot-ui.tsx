import { useEffect, useState } from "react";
import { Rocket, Square, RotateCcw, ExternalLink, RefreshCw } from "lucide-react";
import { useApp } from "./context";
import { api } from "./store";
import { PageHeading } from "./components";
import "./autopilot.css";

type AutomaticJob = { id: string; projectId: string; title: string; status: string; phase: string; error?: string; url?: string; buildId?: string; recoveries: number; maxRecoveryAttempts: number; events: { at: string; text: string }[] };
type Release = { projectId: string; status: string; url?: string; error?: string; previous: unknown; current?: { sourceHash: string }; events: { at: string; text: string }[] };
const labels: Record<string, string> = { queued: "等待执行", running: "自动执行中", retrying: "自动恢复中", cancelling: "停止中", cancelled: "已停止", failed: "执行失败", succeeded: "已部署", planning: "拆解目标", engineering: "开发与实测", releasing: "发布与健康检查", completed: "自动交付完成", live: "运行正常", "rolled-back": "已回滚", unhealthy: "健康异常", "rollback-failed": "回滚异常" };

export function AutopilotPage() {
  const { state, config, session, syncNow, navigate, open, notify } = useApp();
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [criteria, setCriteria] = useState("");
  const [data, setData] = useState<{ jobs: AutomaticJob[]; releases: Release[] }>({ jobs: [], releases: [] });
  const [capability, setCapability] = useState<{ available: boolean; reason: string; recoveryError?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [repairs, setRepairs] = useState(2);
  const [recoveries, setRecoveries] = useState(2);
  const [projectId, setProjectId] = useState("");
  const load = async () => setData(await api<typeof data>("/autopilot"));
  const inspect = async () => {
    try { setCapability(await api<NonNullable<typeof capability>>("/autopilot/capabilities")); }
    catch (error) { setError((error as Error).message); }
  };
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const next = await api<typeof data>("/autopilot");
        if (alive) setData(next);
      } catch (error) { if (alive) setError((error as Error).message); }
    };
    void poll(); void inspect();
    const timer = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const active = data.jobs.some((job) => ["queued", "running", "retrying", "cancelling"].includes(job.status));
  const start = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const revision = await syncNow();
      await api("/autopilot/start", { title, goal, successCriteria: criteria, projectId: projectId || undefined, revision, maxRepairs: repairs, maxRecoveryAttempts: recoveries, maxTokens: 16384 });
      setTitle(""); setGoal(""); setCriteria(""); setProjectId(""); await load();
      notify("全自动任务已启动，关闭页面后仍会继续执行");
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <>
      <PageHeading eyebrow="AUTOPILOT" title="全自动交付" description="输入目标，一次启动后自动规划、开发、修复、实测、部署，并持续检查与回滚。" />
      <div className="autopilot-layout">
        <section className="panel autopilot-form">
          <h2><Rocket size={20} />让目标自动落地</h2>
          <p className="field-hint">支持 React + Express + SQLite 网站。模型和 Docker 环境配置一次后，运行期间无需逐阶段确认；自动发布会调用你的模型并消耗费用。</p>
          <div className={`alert ${capability?.available ? "" : "error"}`}>
            {capability?.reason || "正在检查 Docker Linux 容器环境…"}
            {capability?.recoveryError && <p>{capability.recoveryError}</p>}
            <button type="button" className="text-button" onClick={() => void inspect()}><RefreshCw size={13} />重新检查</button>
          </div>
          {!config?.configured && <p className="alert">先连接一次 AI 模型。<button className="text-button" onClick={() => navigate("settings")}>前往设置</button></p>}
          <form onSubmit={start}>
            <label className="field">交付项目<select value={projectId} onChange={(event) => {
              const id = event.target.value;
              setProjectId(id);
              const project = state.projects.find((item) => item.id === id);
              setTitle(project?.title || ""); setGoal(project?.goal || ""); setCriteria(project?.successCriteria || "");
            }}><option value="">新建应用</option>{state.projects.filter((project) => project.deliveryType === "software" && project.status === "active").map((project) => <option key={project.id} value={project.id}>{project.title} · 自动更新部署</option>)}</select></label>
            <label className="field">应用名称<input required disabled={!!projectId} maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：我的客户跟进工作台" /></label>
            <label className="field">自动交付目标<textarea required disabled={!!projectId} minLength={4} maxLength={10000} rows={6} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="描述用户、数据字段、操作流程和界面要求，系统将自动拆解并交付可运行网站。" /></label>
            <label className="field">可检查的验收标准<textarea disabled={!!projectId} maxLength={3000} rows={3} value={criteria} onChange={(event) => setCriteria(event.target.value)} placeholder="例如：能新增客户、修改状态，刷新和重启后仍能读回，手机可以使用。" /></label>
            {projectId && <p className="field-hint">使用该项目已保存的目标和任务。要调整需求，先在项目详情编辑并保存，再启动自动更新。</p>}
            <div className="form-grid">
              <label className="field">自动修复次数<select value={repairs} onChange={(event) => setRepairs(Number(event.target.value))}>{[0, 1, 2].map((value) => <option key={value} value={value}>{value} 次</option>)}</select></label>
              <label className="field">失败自动恢复<select value={recoveries} onChange={(event) => setRecoveries(Number(event.target.value))}>{[0, 1, 2, 3].map((value) => <option key={value} value={value}>{value} 次</option>)}</select></label>
            </div>
            {error && <p className="alert error" role="alert">{error}</p>}
            <button className="button primary" disabled={busy || active || !capability?.available || !!capability.recoveryError || !config?.configured || !session?.local}><Rocket size={16} />{busy ? "正在启动…" : "全自动开发并部署"}</button>
            <p className="field-hint">生成后端在受限容器执行，页面由受控 Chromium 验证；测试或需求证据未通过会自动修复，到达次数后保留失败记录。服务重启会继续已启动的任务。发布失败自动恢复旧版，失败版数据另存。初次部署默认本机端口；公网域名入口由部署环境一次配置。</p>
          </form>
        </section>
        <div className="autopilot-results">
          {!data.jobs.length && <section className="panel autopilot-job"><h2>等待第一个目标</h2><p>启动后，这里显示各阶段日志、运行地址、失败原因和恢复记录。</p></section>}
          {data.jobs.map((job) => {
            const release = data.releases.find((item) => item.projectId === job.projectId);
            return <section className="panel autopilot-job" key={job.id}>
              <header><h2>{job.title}</h2><span className={`pill ${job.status === "failed" ? "orange" : "green"}`}>{labels[job.status] || job.status}</span></header>
              <p>{labels[job.phase] || job.phase} · 已自动恢复 {job.recoveries}/{job.maxRecoveryAttempts} 次</p>
              {job.error && <p className="alert error">{job.error}</p>}
              {release && <p>部署状态：{labels[release.status] || release.status}{release.error && ` · ${release.error}`}</p>}
              <div className="feature-actions">
                {(release?.url || job.url) && <a className="button primary" href={release?.url || job.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />打开应用</a>}
                <button className="button" onClick={() => open({ type: "project", id: job.projectId, section: "software" })}>工程与测试证据</button>
                {["queued", "running", "retrying", "cancelling"].includes(job.status) && <button className="button" onClick={async () => { try { await api(`/autopilot/${job.id}/stop`, {}); await load(); } catch (error) { setError((error as Error).message); } }}><Square size={14} />停止任务</button>}
                {!!release?.previous && <button className="button" onClick={async () => { try { await api(`/releases/${job.projectId}/rollback`, {}); await load(); } catch (error) { setError((error as Error).message); } }}><RotateCcw size={14} />回滚上一版</button>}
              </div>
              <details open={["running", "retrying"].includes(job.status)}><summary>自动执行记录</summary><ol>{job.events.slice(0, 20).map((event, index) => <li key={`${event.at}-${index}`}><time>{new Date(event.at).toLocaleTimeString("zh-CN")}</time>{event.text}</li>)}</ol></details>
              {release?.events?.length ? <details><summary>部署与回滚记录</summary><ol>{release.events.map((event, index) => <li key={`${event.at}-${index}`}><time>{new Date(event.at).toLocaleTimeString("zh-CN")}</time>{event.text}</li>)}</ol></details> : null}
            </section>;
          })}
        </div>
      </div>
    </>
  );
}
