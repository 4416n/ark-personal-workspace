import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  Smartphone,
  Wifi,
  ShieldCheck,
  Database,
  Download,
  RefreshCw,
  LoaderCircle,
  KeyRound,
} from "lucide-react";
import { api, download } from "./store";
import { useApp } from "./context";
import { Modal } from "./components";
import { stateSchema, type Workspace } from "./domain";
import type { Session } from "./sync";

export function ConnectionGate({
  session,
  error,
  recovery,
}: {
  session: Session | null;
  error: string;
  recovery: string;
}) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const remote = !!session?.remote;
  const pair = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api(remote ? "/auth/login" : "/pair", remote ? { password: code } : { code });
      location.reload();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="connection-gate">
      <section>
        <span className="connection-mark">
          {remote ? <KeyRound size={30} /> : <Smartphone size={30} />}
        </span>
        <h1>{remote ? "登录你的工作台" : "把工作台带到手机上"}</h1>
        <p>{remote ? "输入工作台密码，继续你的项目与交付。" : "连接电脑上的 BOSS 方舟，继续你的项目与灵感。"}</p>
        {error ? (
          <>
            <div className="alert error">{error}</div>
            {recovery && (
              <button
                className="button"
                onClick={() => download("方舟原始数据.json", recovery)}
              >
                导出原始数据
              </button>
            )}
            <button className="button" onClick={() => location.reload()}>
              重新连接
            </button>
          </>
        ) : !session ? (
          <p>
            <LoaderCircle size={16} className="spin" />
            正在连接电脑…
          </p>
        ) : (
          <form onSubmit={pair}>
            <label className="field">
              {remote ? "工作台密码" : "电脑上的连接码"}
              <input
                autoFocus
                type={remote ? "password" : "text"}
                inputMode={remote ? "text" : "numeric"}
                autoComplete={remote ? "current-password" : "one-time-code"}
                pattern={remote ? undefined : "[0-9]{8}"}
                maxLength={remote ? 256 : 8}
                required
                value={code}
                onChange={(e) => setCode(remote ? e.target.value : e.target.value.replace(/\D/g, ""))}
                placeholder={remote ? "输入工作台密码" : "8 位数字"}
              />
            </label>
            <button
              className="button primary"
              disabled={busy || (remote ? !code : code.length !== 8)}
            >
              {busy ? "正在连接…" : remote ? "登录工作台" : "连接我的工作台"}
            </button>
            {message && (
              <div role="alert" className="alert error">
                {message}
              </div>
            )}
            <small>
              {remote ? "密码由部署者设置。连续登录失败会暂时限制尝试，忘记密码请在服务器重新生成密码文件并重启服务。" : "在电脑打开「工作台设置 → 手机连接」，生成一次性连接码。手机和电脑需在同一局域网。"}
            </small>
          </form>
        )}
        <div className="connection-foot">
          <ShieldCheck size={15} />
          {remote ? "资料保存在你部署的服务器上" : "资料保存在你的电脑上"}
        </div>
      </section>
    </div>
  );
}

export function MobileConnection() {
  const { session, notify } = useApp();
  const [info, setInfo] = useState<{
    lan: boolean;
    addresses: { name: string; address: string; url: string }[];
    devices: number;
  } | null>(null);
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [pair, setPair] = useState<{ code: string; expires: number } | null>(
    null,
  );
  const [remaining, setRemaining] = useState(0);
  const load = () =>
    api<NonNullable<typeof info>>("/connection")
      .then((data) => {
        setInfo(data);
        setUrl((s) => s || data.addresses[0]?.url || "");
      })
      .catch((e) => notify(e.message, true));
  useEffect(() => {
    if (session?.local && !session.remote) void load();
  }, [session?.local, session?.remote]);
  useEffect(() => {
    let active = true;
    if (url)
      void QRCode.toDataURL(url, {
        width: 192,
        margin: 2,
        color: { dark: "#263238" },
      }).then((value) => {
        if (active) setQr(value);
      });
    return () => {
      active = false;
    };
  }, [url]);
  useEffect(() => {
    const tick = () =>
      setRemaining(
        Math.max(0, Math.ceil(((pair?.expires || 0) - Date.now()) / 1000)),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [pair]);
  if (session?.remote)
    return (
      <section className="panel settings-section">
        <div className="settings-title">
          <span className="settings-icon green"><ShieldCheck size={21} /></span>
          <div><h2>远程工作台</h2><p>电脑和手机使用同一 HTTPS 地址，通过密码登录。</p></div>
        </div>
        <p>当前登录拥有工作台管理权限。数据保存在服务器，模型密钥不会返回浏览器。会话有效期为七天，重启服务后需重新登录。</p>
      </section>
    );
  return (
    <section className="panel settings-section connection-panel">
      <div className="settings-title">
        <span className="settings-icon green">
          <Smartphone size={21} />
        </span>
        <div>
          <h2>手机连接</h2>
          <p>同一个 Wi-Fi，电脑和手机接着做。</p>
        </div>
        <span className="pill green">局域网版</span>
      </div>
      {!session?.local ? (
        <div className="connection-device">
          <Wifi size={22} />
          <div>
            <strong>已连接电脑工作台</strong>
            <p>项目、成果和笔记共享。连接码与模型密钥请在电脑管理。</p>
          </div>
          <button className="button" onClick={() => location.reload()}>
            刷新连接
          </button>
        </div>
      ) : !info?.lan ? (
        <p>
          使用「启动工作台.sh」或 npm start 启动局域网服务后，即可连接手机。
        </p>
      ) : (
        <>
          <div className="connection-grid">
            <div className="connection-qr">
              {qr ? (
                <img
                  src={qr}
                  width={192}
                  height={192}
                  alt="手机访问工作台二维码"
                />
              ) : (
                <p>未发现可用的局域网地址，请连接 Wi-Fi 或网线后刷新。</p>
              )}
              <small>用手机相机扫码打开</small>
            </div>
            <div className="connection-instructions">
              <ol>
                <li>电脑保持开机，手机连接同一 Wi-Fi。</li>
                <li>扫码或输入下方地址，在浏览器打开。</li>
                <li>输入电脑生成的连接码，开始使用。</li>
              </ol>
              {info.addresses.length > 1 && (
                <label className="field">
                  选择网络
                  <select
                    aria-label="选择局域网地址"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  >
                    {info.addresses.map((x) => (
                      <option key={x.url} value={x.url}>
                        {x.address} · {x.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <input
                className="connection-url"
                aria-label="手机访问地址"
                value={url}
                readOnly
                onFocus={(e) => e.target.select()}
              />
              <div className="inline-controls">
                <button
                  className="button primary"
                  onClick={async () => {
                    try {
                      setPair(await api("/connection/code", {}));
                    } catch (e) {
                      notify((e as Error).message, true);
                    }
                  }}
                >
                  生成连接码
                </button>
                <button className="text-button" onClick={() => void load()}>
                  <RefreshCw size={14} />
                  刷新地址
                </button>
              </div>
              {pair && (
                <div className="pair-code">
                  <strong>{remaining > 0 ? pair.code : "已过期"}</strong>
                  <small>
                    一次有效 ·{" "}
                    {remaining > 0 ? `${remaining} 秒后过期` : "请重新生成"}
                  </small>
                </div>
              )}
            </div>
          </div>
          <p className="connection-note">
            仅供可信家庭/办公局域网使用（HTTP）。电脑休眠、关机或离开此网络后无法连接；本版不支持外网访问。连接码
            5 分钟有效，设备授权 7 天，服务重启后需重新连接。
          </p>
          <div className="connection-device">
            <span>已授权 {info.devices} 台设备</span>
            <button
              className="text-button danger"
              onClick={async () => {
                if (
                  !confirm("断开所有手机与其他设备？它们需要重新输入连接码。")
                )
                  return;
                try {
                  await api("/connection/devices", undefined, "DELETE");
                  setPair(null);
                  await load();
                  notify("其他设备已断开");
                } catch (e) {
                  notify((e as Error).message, true);
                }
              }}
            >
              断开其他设备
            </button>
          </div>
        </>
      )}
    </section>
  );
}

type Backup = {
  id: string;
  revision: number;
  at: string;
  label: string;
  size: number;
};
export function BackupPanel() {
  const { state, update, session, notify } = useApp();
  const [rows, setRows] = useState<Backup[]>([]);
  const [preview, setPreview] = useState<{
    backup: Backup;
    state: Workspace;
  } | null>(null);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [migrationBackup] = useState(() => {
    try {
      return localStorage.getItem("ark-workspace-v1-before-server-migration");
    } catch {
      return null;
    }
  });
  const load = () =>
    api<Backup[]>("/backups")
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (session?.shared) void load();
    const snapshotsChanged = () => {
      if (session?.shared) void load();
    };
    window.addEventListener("ark-snapshots-changed", snapshotsChanged);
    return () =>
      window.removeEventListener("ark-snapshots-changed", snapshotsChanged);
  }, [session?.shared]);
  if (!session?.shared) return null;
  return (
    <section className="panel settings-section">
      <div className="settings-title">
        <span className="settings-icon blue">
          <Database size={20} />
        </span>
        <div>
          <h2>{session.remote ? "服务器自动备份" : "电脑自动备份"}</h2>
          <p>每次保存前留下快照，也可找回误删的项目。</p>
        </div>
      </div>
      <p className="field-hint">
        业务数据存入{session.remote ? "服务器" : "电脑"}数据库；新增快照时保留最近最多 50 份、合计 32 MiB，
        至少保留最新一份。另保留 30 个有保存记录日期的每日备份。
        仅业务数据，不含工程源码与执行日志；整机迁移请用完整备份。恢复前会再次备份当前状态。
      </p>
      <div className="inline-controls feature-actions">
        {migrationBackup && (
          <button
            className="button"
            onClick={() =>
              download("方舟升级前浏览器数据.json", migrationBackup)
            }
          >
            导出升级前浏览器数据
          </button>
        )}
        <button
          className="button"
          onClick={async () => {
            try {
              await api("/backups", {});
              await load();
              notify("手动快照已保存");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          立即备份
        </button>
        <button className="text-button" onClick={() => void load()}>
          刷新备份列表
        </button>
      </div>
      {error && <p className="alert error">{error}</p>}
      <div className="backup-list">
        {rows.map((b) => (
          <button
            key={b.id}
            onClick={async () => {
              try {
                const r = await api<{ state: Workspace }>(`/backups/${b.id}`);
                setPreview({ backup: b, state: stateSchema.parse(r.state) });
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <span>
              <strong>{new Date(b.at).toLocaleString("zh-CN")}</strong>
              <small>
                {b.label} · 版本 {b.revision}
              </small>
            </span>
            <span>预览 / 恢复</span>
          </button>
        ))}
        {!rows.length && <p>首次修改后会自动生成快照。</p>}
      </div>
      {preview && (
        <Modal
          title="预览恢复内容"
          subtitle="将用这份快照替换共享工作台，电脑和手机都会同步。"
          onClose={() => setPreview(null)}
        >
          <div className="modal-body">
            <p>{new Date(preview.backup.at).toLocaleString("zh-CN")}</p>
            <div className="restore-comparison">
              {(
                [
                  ["项目", "projects"],
                  ["任务", "tasks"],
                  ["知识", "knowledge"],
                ] as const
              ).map(([label, key]) => (
                <div key={key}>
                  <strong>{label}</strong>
                  <span>
                    现在 {state[key].length} → 恢复为{" "}
                    {preview.state[key].length}
                  </span>
                </div>
              ))}
            </div>
            <p className="field-hint">模型密钥和 AI 执行日志不受影响。</p>
          </div>
          <footer className="modal-footer">
            <button
              className="button"
              onClick={() =>
                download(
                  "方舟快照.json",
                  JSON.stringify(preview.state, null, 2),
                )
              }
            >
              <Download size={15} />
              导出此份
            </button>
            <button
              className="button primary"
              disabled={restoring}
              onClick={async () => {
                setRestoring(true);
                try {
                  await api("/backups", {});
                  update(() => preview.state, "从电脑快照恢复工作台");
                  setPreview(null);
                  notify("已载入快照，请等待电脑保存完成");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setRestoring(false);
                }
              }}
            >
              {restoring ? "正在恢复…" : "确认恢复这份快照"}
            </button>
          </footer>
        </Modal>
      )}
    </section>
  );
}
