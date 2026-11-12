import { useCallback, useEffect, useState } from "react";
import { HardDrive, RefreshCw } from "lucide-react";
import { useApp } from "./context";
import { Modal } from "./components";
import { api } from "./store";

type StorageStatus = {
  revision: number;
  tables: Record<
    "workspace" | "snapshots" | "builds" | "runs" | "automations",
    { count: number; bytes: number }
  >;
  fullBackup: {
    logicalBytes: number;
    logicalLimitBytes: number;
    withinLogicalLimit: boolean;
    rawLimitBytes: number;
    compressedLimitBytes: number;
  };
  snapshots: {
    fingerprint: string;
    maxCount: number;
    maxBytes: number;
    keepLatest: boolean;
    retainedCount: number;
    retainedBytes: number;
    prunableCount: number;
    prunableBytes: number;
    oversizedLatest: boolean;
  };
  canFullBackup: boolean;
  warning: string;
  note: string;
};

const storageLabels = {
  workspace: "当前业务",
  snapshots: "历史快照",
  builds: "工程版本",
  runs: "执行日志",
  automations: "执行批次",
} as const;

function bytesLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function StorageStatusPanel({
  disabled = false,
  onPruned,
}: {
  disabled?: boolean;
  onPruned?: () => void;
}) {
  const { session, syncNow } = useApp();
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [confirmation, setConfirmation] = useState<StorageStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const local = !!session?.shared && !!session.local;

  useEffect(() => {
    if (!local) return;
    let mounted = true;
    void api<StorageStatus>("/storage-status")
      .then((result) => {
        if (mounted) setStatus(result);
      })
      .catch((e: Error) => {
        if (mounted) setError(e.message);
      });
    return () => {
      mounted = false;
    };
  }, [local]);

  const refresh = useCallback(
    async (prepare = false) => {
      setBusy(prepare ? "正在核对快照…" : "正在读取容量…");
      setError("");
      setNotice("");
      try {
        if (prepare) await syncNow();
        const next = await api<StorageStatus>("/storage-status");
        setStatus(next);
        if (prepare) {
          if (next.snapshots.prunableCount) setConfirmation(next);
          else setNotice("当前历史快照在保留范围内，无需整理。");
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy("");
      }
    },
    [syncNow],
  );

  const prune = async () => {
    if (!confirmation) return;
    setBusy("正在整理旧快照…");
    setError("");
    try {
      // Submit the revision the user reviewed. A newer save must require a new preview.
      const result = await api<{
        removedCount: number;
        removedBytes: number;
        status: StorageStatus;
      }>("/snapshots/prune", {
        confirmed: true,
        revision: confirmation.revision,
        snapshotFingerprint: confirmation.snapshots.fingerprint,
      });
      setStatus(result.status);
      setConfirmation(null);
      setNotice(
        `已整理 ${result.removedCount} 份旧快照，减少 ${bytesLabel(result.removedBytes)} 备份数据。`,
      );
      window.dispatchEvent(new Event("ark-snapshots-changed"));
      onPruned?.();
    } catch (e) {
      setConfirmation(null);
      setError(`${(e as Error).message}；请刷新容量后重新核对。`);
    } finally {
      setBusy("");
    }
  };

  if (!local) return null;
  return (
    <section
      className="storage-status"
      aria-label="备份容量"
      aria-busy={!!busy}
    >
      <div className="storage-status-heading">
        <h3>
          <HardDrive size={16} />
          备份容量
        </h3>
        <button
          className="text-button"
          disabled={disabled || !!busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} />
          刷新容量
        </button>
      </div>
      {status && (
        <>
          <p className="storage-summary">
            <strong>{bytesLabel(status.fullBackup.logicalBytes)}</strong>
            <span>
              {" "}
              / {bytesLabel(status.fullBackup.logicalLimitBytes)} 逻辑数据上限
            </span>
          </p>
          <dl className="storage-breakdown">
            {Object.entries(storageLabels).map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  {bytesLabel(
                    status.tables[key as keyof typeof storageLabels].bytes,
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="field-hint">
            当前 {status.tables.snapshots.count} 份快照。新增快照时最多保留最近{" "}
            {status.snapshots.maxCount} 份、合计{" "}
            {bytesLabel(status.snapshots.maxBytes)}，至少保留最新一份。
            容量按备份数据计算，整理后数据库文件不会立即缩小。
          </p>
          {status.warning && (
            <p className="alert" role="status">
              {status.warning}
            </p>
          )}
          <p className="field-hint">{status.note}</p>
          {status.snapshots.prunableCount > 0 && (
            <div className="storage-prune-actions">
              <p>
                可整理 {status.snapshots.prunableCount} 份旧快照，减少约{" "}
                {bytesLabel(status.snapshots.prunableBytes)}。
              </p>
              <button
                className="button"
                disabled={disabled || !!busy}
                onClick={() => void refresh(true)}
              >
                整理旧快照
              </button>
            </div>
          )}
        </>
      )}
      {!status && !error && <p className="field-hint">正在读取容量…</p>}
      {busy && <p role="status">{busy}</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {confirmation && (
        <Modal
          title="整理旧快照"
          subtitle="请核对将移除的历史记录，整理后无法从工作台恢复这些旧快照。"
          onClose={() => {
            if (!busy) setConfirmation(null);
          }}
        >
          <div className="modal-body">
            <p>
              将移除最早的 {confirmation.snapshots.prunableCount} 份超额快照，
              减少约 {bytesLabel(confirmation.snapshots.prunableBytes)}，
              保留最近 {confirmation.snapshots.retainedCount} 份。
            </p>
            <p>
              当前项目与资料、工程版本、执行日志和恢复前的独立安全备份都会保留。
            </p>
            <p>
              {confirmation.canFullBackup
                ? "需要这些旧快照时，请先取消并导出完整备份；如果导出仍超过档案大小限制，请使用 SQLite 在线备份。"
                : "当前完整导出已超过容量上限。需要保留这些旧快照时，请先取消并使用 SQLite 在线备份，再回来整理。"}
            </p>
            <p className="field-hint">
              整理前需停止所有 AI / 工程执行；核对后数据有新修改时会拒绝操作。
            </p>
          </div>
          <footer className="modal-footer">
            <button
              className="button"
              disabled={!!busy}
              onClick={() => setConfirmation(null)}
            >
              取消
            </button>
            <button
              className="button primary"
              disabled={disabled || !!busy}
              onClick={() => void prune()}
            >
              {busy || "确认整理"}
            </button>
          </footer>
        </Modal>
      )}
    </section>
  );
}
