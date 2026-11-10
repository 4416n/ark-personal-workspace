import { useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  FileCode2,
  Play,
  Square,
  AlertTriangle,
  RotateCw,
} from "lucide-react";
import { useApp } from "./context";
import { api } from "./store";

type CheckResult = {
  name: string;
  passed: boolean;
  detail: string;
  durationMs?: number;
};
type Build = {
  id: string;
  title: string;
  mode?: "generate" | "validate";
  baseBuildId?: string | null;
  baseSourceHash?: string | null;
  status: string;
  summary: string;
  error: string;
  sourceHash: string;
  stale: boolean;
  hasScreenshot: boolean;
  startedAt: string;
  attempt: number;
  maxRepairs: number;
  files: { path: string; bytes: number }[];
  validation: {
    passed: boolean;
    unavailable?: boolean;
    checks: CheckResult[];
    logs: string;
    scope?: string;
    durationMs?: number;
  } | null;
  attempts: {
    number: number;
    passed: boolean;
    logs: string;
    checks: CheckResult[];
  }[];
};
type BuildList = { builds: Build[]; activeProjectId: string | null };
const names: Record<string, string> = {
  generating: "正在生成源码",
  validating: "正在隔离测试",
  cancelling: "正在停止",
  verified: "构建与冒烟通过",
  failed: "未通过验证",
  cancelled: "已停止",
  interrupted: "服务中断",
};
const running = (b?: Build) =>
  !!b && ["generating", "validating", "cancelling"].includes(b.status);
export const softwareConfirmation = (
  title: string,
  repairs: number,
  maxTokens = 8192,
) =>
  `交付「${title}」的完整网站工程？\n\n将生成 React 前端、Express 后端、SQLite 数据库代码、测试用例与 Docker 部署文件，并在隔离环境中运行生成的代码，按实际错误自动修复。最多 ${repairs + 1} 次模型调用（首次生成 + ${repairs} 次修复），单次输出上限 ${maxTokens} tokens，需模型支持，消耗已配置模型额度。项目需求、任务成果、上一版源码及检索资料会发送给该模型。\n\n关闭页面仍继续，电脑服务必须运行；可随时停止。不会在宿主机直接运行生成的代码，也不会实际上线、安装项目依赖或连接外部业务服务。沙箱不可用时仅生成未验证源码。Windows 会验证构建、接口和数据库，不跑浏览器；Linux 还会做浏览器冒烟。\n\n检查通过只表示这些自动检查通过，不代表所有业务与安全要求已验收。`;

export function SoftwarePanel({ projectId }: { projectId: string }) {
  const { state, config, session, syncNow, navigate, open } = useApp();
  const project = state.projects.find((p) => p.id === projectId);
  const [list, setList] = useState<BuildList>({
    builds: [],
    activeProjectId: null,
  });
  const [selected, select] = useState("");
  const [file, setFile] = useState("src/main.jsx");
  const [source, setSource] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [repairs, setRepairs] = useState(1);
  const [maxTokens, setMaxTokens] = useState(8192);
  const [baseChoice, setBaseChoice] = useState("recommended");
  const [loaded, setLoaded] = useState(false);
  const [cap, setCap] = useState<{ available: boolean; reason: string } | null>(
    null,
  );
  const alive = useRef(true);
  const loadSequence = useRef(0);
  const load = async () => {
    const sequence = ++loadSequence.current;
    const next = await api<BuildList>(`/software/${projectId}`);
    if (alive.current && sequence === loadSequence.current) {
      setList(next);
      setLoaded(true);
      select((id) =>
        next.builds.some((b) => b.id === id) ? id : next.builds[0]?.id || "",
      );
    }
    return next;
  };
  useEffect(() => {
    alive.current = true;
    let pending = false;
    const poll = async () => {
      if (!session?.shared || pending) return;
      pending = true;
      try {
        await load();
      } catch (e) {
        if (alive.current) setError((e as Error).message);
      } finally {
        pending = false;
      }
    };
    void poll();
    if (session?.shared)
      void api<{ available: boolean; reason: string }>("/software-capabilities")
        .then((c) => {
          if (alive.current) setCap(c);
        })
        .catch((e) => {
          if (alive.current) setError(e.message);
        });
    const timer = setInterval(() => void poll(), 1800);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [projectId, session?.shared]);
  const build = list.builds.find((b) => b.id === selected);
  const active = list.builds.find(running);
  const candidates = list.builds.filter((b) => b.files.length && !running(b));
  const generationBase =
    baseChoice === "recommended"
      ? candidates.find((b) => b.status === "verified") || candidates[0]
      : candidates.find((b) => b.id === baseChoice);
  const baseMissing =
    !["recommended", "fresh"].includes(baseChoice) && !generationBase;
  const baseDescription = generationBase
    ? `基于 ${generationBase.sourceHash.slice(0, 8)}（${names[generationBase.status]}）继续修改`
    : "从当前需求重新生成，不使用旧源码";
  useEffect(() => {
    let live = true;
    setSource("");
    setSourceError("");
    if (build?.files.length && !build.files.some((f) => f.path === file)) {
      setFile("src/main.jsx");
      return () => {
        live = false;
      };
    }
    if (build?.files.some((f) => f.path === file))
      void api<{ content: string }>(
        `/software-builds/${build.id}/file?path=${encodeURIComponent(file)}`,
      )
        .then((r) => {
          if (live) setSource(r.content);
        })
        .catch((e) => {
          if (live) setSourceError(e.message);
        });
    return () => {
      live = false;
    };
  }, [build?.id, build?.sourceHash, file]);
  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const revision = await syncNow();
      if (
        !confirm(
          softwareConfirmation(project?.title || "项目", repairs, maxTokens) +
            "\n\n本次生成起点：" +
            baseDescription,
        )
      )
        return;
      const next = await api<Build>(`/software/${projectId}/start`, {
        confirmed: true,
        allowSandbox: true,
        revision,
        maxRepairs: repairs,
        maxTokens,
        baseBuildId: generationBase?.id || null,
      });
      select(next.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const revalidate = async () => {
    if (!build || busy) return;
    setBusy(true);
    setError("");
    try {
      const revision = await syncNow();
      if (
        !confirm(
          `重新验证源码 ${build.sourceHash.slice(0, 8)}？\n\n不调用 AI、不消耗模型额度。保留此版应用源码与测试用例，更新平台构建/验证脚本，另存新版本并在隔离环境运行。不会覆盖原版，也不会自动修复代码。\n\n旧需求的源码不会因重测而变成符合新需求；验证通过仍不等于完整业务验收或上线。`,
        )
      )
        return;
      const next = await api<Build>(`/software-builds/${build.id}/revalidate`, {
        confirmed: true,
        allowSandbox: true,
        revision,
      });
      select(next.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const cancel = async () => {
    if (!active || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/software-builds/${active.id}/cancel`, {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const download = async () => {
    if (!build || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/software-builds/${build.id}/download`);
      if (!res.ok) throw new Error((await res.json()).error || "工程下载失败");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${build.title.replace(/[\\/:*?"<>|]/g, "-")}-${build.sourceHash.slice(0, 8)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  if (!session?.shared)
    return (
      <div className="alert">
        工程交付需要电脑共享数据库。请用 npm start 启动，并在设置中连接 AI
        模型。
      </div>
    );
  return (
    <section
      className="software-panel"
      aria-label="完整工程交付"
      data-live-project
    >
      <header className="software-heading">
        <div>
          <h3>
            <FileCode2 size={22} />
            交付一个能运行的项目
          </h3>
          <p>不是说明文档。源码、数据库、测试和部署文件，在同一个工程里。</p>
        </div>
        <span
          className={`pill ${build?.status === "verified" ? "green" : "neutral"}`}
        >
          {build ? names[build.status] || build.status : "等待生成"}
        </span>
      </header>
      <div className="software-stack">
        <span>React 前端</span>
        <span>Express 接口</span>
        <span>SQLite 数据</span>
        <span>Docker 部署文件</span>
      </div>
      <p className="software-note">
        支持此技术栈的网站首版。支付、真实账号、外部服务等需要另行集成与安全审查；部署文件不等于已上线。项目任务作为需求参考，不会因冒烟通过就全部标记完成。
      </p>
      <details className="software-environment">
        <summary>
          运行验证环境 ·{" "}
          {cap
            ? cap.available
              ? "隔离环境就绪"
              : "不可用，只能交付未验证源码"
            : "正在检测"}
        </summary>
        <p>{cap?.reason || "正在检查，不会在宿主机直接执行生成的代码。"}</p>
        <p>
          生成 → 实际构建与测试 → 失败自动修复 → 保存版本。每个项目保留最近 5
          版，全局最多 30 版；重要版本请下载备份，工作台 JSON
          导出不包含工程源码。
        </p>
      </details>
      {!!candidates.length && (
        <div className="software-base">
          <label>
            本次生成起点{" "}
            <select
              aria-label="工程生成起点"
              value={baseChoice}
              disabled={busy || !!list.activeProjectId}
              onChange={(e) => setBaseChoice(e.target.value)}
            >
              <option value="recommended">自动推荐：优先最近验证通过版</option>
              <option value="fresh">从头生成，不使用旧源码</option>
              {candidates.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.sourceHash.slice(0, 8)} ·{" "}
                  {new Date(b.startedAt).toLocaleString("zh-CN")} ·{" "}
                  {names[b.status]}
                </option>
              ))}
              {baseMissing && (
                <option value={baseChoice}>
                  该版本已超出保留上限，请重新选择
                </option>
              )}
            </select>
          </label>
          <small>
            {baseMissing
              ? "生成起点不可用，请重新选择；不会悄悄改用其他版本。"
              : baseDescription}
          </small>
        </div>
      )}
      <div className="software-controls">
        <label>
          自动修复{" "}
          <select
            aria-label="工程自动修复次数"
            value={repairs}
            disabled={!!list.activeProjectId || busy}
            onChange={(e) => setRepairs(Number(e.target.value))}
          >
            <option value={0}>不修复 · 最多 1 次调用</option>
            <option value={1}>1 次 · 最多 2 次调用</option>
            <option value={2}>2 次 · 最多 3 次调用</option>
          </select>
        </label>
        <label>
          单次输出{" "}
          <select
            aria-label="工程输出上限"
            value={maxTokens}
            disabled={!!list.activeProjectId || busy}
            onChange={(e) => setMaxTokens(Number(e.target.value))}
          >
            <option value={8192}>8k tokens</option>
            <option value={16384}>16k（需模型支持）</option>
            <option value={32768}>32k（需模型支持）</option>
          </select>
        </label>
        {active ? (
          <button
            className="button"
            disabled={busy || active.status === "cancelling"}
            onClick={() => void cancel()}
          >
            <Square size={14} />
            停止工程交付
          </button>
        ) : (
          <button
            className="button primary"
            disabled={
              busy ||
              !!list.activeProjectId ||
              !config?.configured ||
              !loaded ||
              baseMissing ||
              project?.status !== "active"
            }
            onClick={() => void start()}
          >
            <Play size={14} />
            {build ? "生成新版本" : "生成完整工程"}
          </button>
        )}
        {!config?.configured && (
          <button
            className="text-button"
            onClick={() => {
              open(null);
              navigate("settings");
            }}
          >
            先连接 AI 模型
          </button>
        )}
        {!!build?.files.length && (
          <button
            className="button"
            disabled={busy || !!list.activeProjectId || running(build)}
            onClick={() => void revalidate()}
          >
            <RotateCw size={15} />
            仅重新验证（不调用 AI）
          </button>
        )}
        {!!build?.files.length && (
          <button
            className="button"
            disabled={busy || running(build)}
            onClick={() => void download()}
          >
            <Download size={15} />
            {build.status === "verified"
              ? "下载完整工程 ZIP"
              : "下载源码 ZIP（未验证通过）"}
          </button>
        )}
      </div>
      {active && (
        <p className="software-live" role="status">
          {names[active.status]} ·{" "}
          {active.mode === "validate"
            ? "只运行已有源码，0 次模型调用。关闭页面仍会继续，可随时停止。"
            : `第 ${active.attempt || 1}/${active.maxRepairs + 1} 次模型调用。关闭页面仍会继续；停止可能仍产生已处理部分的费用。`}
        </p>
      )}
      {list.activeProjectId && !active && (
        <p className="alert">
          另一个项目正在执行工程交付，请等待或从顶部后台状态条停止。
        </p>
      )}
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {!build && (
        <div className="software-empty">
          <FileCode2 size={32} />
          <h4>第一份工程，从你的项目目标开始</h4>
          <p>
            写清页面、用户操作、数据和验收标准，再生成完整工程。实际的文件与运行结果会出现在这里。
          </p>
        </div>
      )}
      {build && (
        <>
          <div className="software-version">
            <label>
              工程版本{" "}
              <select
                aria-label="工程版本"
                value={selected}
                onChange={(e) => select(e.target.value)}
              >
                {list.builds.map((b) => (
                  <option key={b.id} value={b.id}>
                    {new Date(b.startedAt).toLocaleString("zh-CN")} ·{" "}
                    {names[b.status]}
                    {b.mode === "validate" ? " · 仅重验" : ""}
                  </option>
                ))}
              </select>
            </label>
            <small>
              {build.files.length} 个文件 ·{" "}
              {Math.ceil(build.files.reduce((n, f) => n + f.bytes, 0) / 1024)}{" "}
              KB
            </small>
          </div>
          {build.baseBuildId && (
            <p className="software-lineage">
              {build.mode === "validate"
                ? "仅重验：保留应用源码，更新平台脚本；没有调用模型。"
                : "基于已有源码生成。"}{" "}
              来源版本{" "}
              {build.baseSourceHash?.slice(0, 8) ||
                list.builds
                  .find((b) => b.id === build.baseBuildId)
                  ?.sourceHash.slice(0, 8) ||
                build.baseBuildId.slice(0, 8)}
              {!list.builds.some((b) => b.id === build.baseBuildId) &&
                "（已超出历史保留上限）"}
            </p>
          )}
          {build.stale && (
            <p className="alert">
              <AlertTriangle size={15} />
              需求或项目资料已变更。这一版对应旧需求，需要生成新版本再验证。
            </p>
          )}
          {build.error && <p className="alert error">{build.error}</p>}
          {build.validation && !build.validation.passed && (
            <details className="software-logs" open>
              <summary>本次验证失败日志</summary>
              <pre>
                {build.validation.logs || "没有附加日志，请查看下方检查项。"}
              </pre>
            </details>
          )}
          {build.summary && <p className="software-note">{build.summary}</p>}
          {!!build.files.length && (
            <div className="software-workspace">
              <nav className="software-files" aria-label="工程文件">
                <strong>工程文件</strong>
                {build.files.map((f) => (
                  <button
                    key={f.path}
                    className={file === f.path ? "selected" : ""}
                    aria-pressed={file === f.path}
                    onClick={() => setFile(f.path)}
                    title={f.path}
                  >
                    <span>{f.path}</span>
                    <small>{Math.ceil(f.bytes / 1024)}k</small>
                  </button>
                ))}
              </nav>
              <div className="software-source">
                <header>
                  <strong>{file}</strong>
                  <small>只读源码</small>
                </header>
                <pre tabIndex={0} aria-label="文件源码">
                  <code>{sourceError || source || "正在读取文件…"}</code>
                </pre>
              </div>
            </div>
          )}
          {build.sourceHash && (
            <p className="software-hash">
              源码 SHA-256 <code>{build.sourceHash}</code>
            </p>
          )}
          <section className="software-checks" aria-label="工程验证结果">
            <h4>
              实际验证结果
              {build.validation?.durationMs !== undefined && (
                <small>
                  {" "}
                  · 耗时 {(build.validation.durationMs / 1000).toFixed(1)} 秒
                </small>
              )}
            </h4>
            <p className="software-note">
              {build.validation?.scope || "未产生验证报告，不代表已经通过。"}{" "}
              测试用例由模型声明，未做独立安全审计、Docker
              镜像构建或公开部署验证。
            </p>
            {build.validation?.checks.map((c, i) => (
              <details key={i}>
                <summary>
                  {c.passed ? <Check size={16} /> : <AlertTriangle size={16} />}
                  <span>{c.name}</span>
                  {c.durationMs !== undefined && (
                    <small>{(c.durationMs / 1000).toFixed(1)}s</small>
                  )}
                  <b>{c.passed ? "通过" : "失败"}</b>
                </summary>
                <pre>{c.detail}</pre>
              </details>
            ))}
          </section>
          {!!build.attempts.length && (
            <details className="software-logs">
              <summary>生成与修复记录 · {build.attempts.length} 轮</summary>
              {build.attempts.map((a, i) => (
                <div key={i}>
                  <h4>
                    第 {a.number} 轮 · {a.passed ? "通过" : "失败"}
                  </h4>
                  <pre>{a.logs || "无附加日志"}</pre>
                </div>
              ))}
            </details>
          )}
          {build.hasScreenshot && (
            <figure className="software-preview">
              <img
                src={`/api/software-builds/${build.id}/screenshot?v=${build.sourceHash}`}
                alt="此版本在隔离浏览器中实际运行的截图"
              />
              <figcaption>
                此版本实际运行截图（非可交互在线站点）。下载后按 DEPLOY.md
                启动。
              </figcaption>
            </figure>
          )}
          {!!build.files.length && (
            <details className="software-environment">
              <summary>拿到工程后怎么启动？</summary>
              <p>
                解压 ZIP，在工程目录使用 Node.js 24+：
                <code>
                  npm ci &amp;&amp; npm run build &amp;&amp; npm start
                </code>
                ，访问 http://127.0.0.1:8080。也可运行{" "}
                <code>docker compose up --build -d</code>
                。首次安装与镜像构建需要网络。
              </p>
              <p>
                完整说明见 DEPLOY.md；验证报告见
                verification-report.json。公开上线前配置域名、HTTPS、认证与备份。源码不包含工作台
                API Key。
              </p>
            </details>
          )}
        </>
      )}
    </section>
  );
}
