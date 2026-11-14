import { useRef, useState } from "react";
import { Archive, Download, Upload, ShieldCheck } from "lucide-react";
import { useApp } from "./context";
import { Modal } from "./components";
import { api, downloadBytes } from "./store";
import { StorageStatusPanel } from "./storage-ui";
type Preview = {
  token: string;
  expiresAt: number;
  createdAt: string;
  checksum: string;
  counts: Record<string, number>;
};
const labels: Record<string, string> = {
  projects: "项目",
  tasks: "任务",
  knowledge: "知识",
  templates: "流程模板",
  builds: "工程版本",
  runs: "执行日志",
  automations: "执行批次",
  snapshots: "业务快照",
};
export function FullBackupPanel() {
  const { session, syncNow } = useApp();
  const file = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!session?.shared) return null;
  const check = async (response: Response) => {
    if (!response.ok)
      throw new Error((await response.json()).error || "备份操作失败");
    return response;
  };
  const exportBackup = async () => {
    setBusy("正在打包完整备份…");
    setError("");
    try {
      await syncNow();
      const response = await check(
        await fetch("/api/full-backup", {
          signal: AbortSignal.timeout(120000),
        }),
      );
      downloadBytes(
        `方舟完整备份-${new Date().toISOString().slice(0, 10)}.arkbackup.gz`,
        new Uint8Array(await response.arrayBuffer()),
        "application/gzip",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const importBackup = async (selected?: File) => {
    if (!selected) return;
    setPreview(null);
    setError("");
    if (selected.size > 64 * 1024 * 1024) {
      setError("请选择 64 MB 以内的完整备份文件");
      return;
    }
    setBusy("正在校验文件与工程源码…");
    try {
      await syncNow();
      const response = await check(
        await fetch("/api/full-backup/preview", {
          method: "POST",
          headers: { "Content-Type": "application/gzip" },
          body: selected,
          signal: AbortSignal.timeout(120000),
        }),
      );
      setPreview(await response.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="panel settings-section full-backup-panel">
      <div className="settings-title">
        <span className="settings-icon green">
          <Archive size={20} />
        </span>
        <div>
          <h2>完整迁移备份</h2>
          <p>业务、工程源码、执行记录与历史快照，一份文件带走。</p>
        </div>
      </div>
      <p className="field-hint">
        不包含模型连接配置与 API
        Key、已配对设备授权、外部部署的网站数据。备份中含私人资料和源码，请勿上传公开仓库。恢复前自动保留当前完整备份；恢复的工程需要重新验证，AI
        执行保持停止。
      </p>
      <StorageStatusPanel disabled={!!busy} onPruned={() => setPreview(null)} />
      {!session.local ? (
        <p className="alert">
          完整备份与恢复仅在电脑本机地址操作；手机可继续使用业务数据导出。
        </p>
      ) : (
        <div className="inline-controls feature-actions">
          <button
            className="button"
            disabled={!!busy}
            onClick={() => void exportBackup()}
          >
            <Download size={15} />
            下载完整备份
          </button>
          <button
            className="button"
            disabled={!!busy}
            onClick={() => file.current?.click()}
          >
            <Upload size={15} />
            选择完整备份并校验
          </button>
          <input
            ref={file}
            type="file"
            hidden
            accept=".gz,application/gzip"
            aria-label="完整备份文件"
            onChange={(e) => {
              void importBackup(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      )}
      {busy && <p role="status">{busy}</p>}
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <Modal
          wide
          title="核对完整备份"
          subtitle="校验和通过不代表文件来源可信；只恢复你信任的备份。"
          onClose={() => {
            if (!busy) setPreview(null);
          }}
        >
          <div className="modal-body">
            <p>
              <ShieldCheck size={16} /> 创建于{" "}
              {new Date(preview.createdAt).toLocaleString("zh-CN")}
            </p>
            <dl className="backup-counts">
              {Object.entries(labels).map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{preview.counts[key] || 0}</dd>
                </div>
              ))}
            </dl>
            <p className="field-hint">
              SHA-256{" "}
              <code className="backup-checksum">{preview.checksum}</code>
            </p>
            <div className="alert">
              将替换当前业务、工程、日志与快照。{session.remote ? "请先关闭其他工作台窗口；恢复后所有设备需重新登录。" : "请先关闭其他电脑窗口；手机需重新配对。"}模型配置保持不变。预览后有新修改或执行记录时会拒绝恢复，请重新校验。
            </div>
            <p>
              当前完整备份会先保存到{session.remote ? "服务器" : "电脑"}的 <code>.local/full-backups/</code>
              （自定义数据目录则在该目录下）。此文件不会自动清理。
            </p>
            {error && (
              <p className="alert error" role="alert">
                {error}
              </p>
            )}
          </div>
          <footer className="modal-footer">
            <button
              className="button"
              disabled={!!busy}
              onClick={() => setPreview(null)}
            >
              取消
            </button>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={async () => {
                if (
                  !window.confirm(
                    "确认用这份完整备份替换当前工作台？当前数据会先独立备份，恢复后页面刷新，手机需要重新配对。",
                  )
                )
                  return;
                setBusy("正在保存恢复前备份并原子恢复…");
                setError("");
                try {
                  const revision = await syncNow();
                  await api("/full-backup/restore", {
                    token: preview.token,
                    revision,
                    confirmed: true,
                  });
                  localStorage.removeItem("ark-workspace-pending-v3");
                  window.location.reload();
                } catch (e) {
                  setError((e as Error).message);
                  setBusy("");
                }
              }}
            >
              {busy || "备份当前数据并恢复"}
            </button>
          </footer>
        </Modal>
      )}
    </section>
  );
}
