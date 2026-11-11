import { createHash } from "node:crypto";

export const MAX_SNAPSHOT_COUNT = 50;
export const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
export const MAX_FULL_BACKUP_LOGICAL_BYTES = 250 * 1024 * 1024;

export function storagePolicy({
  snapshotMaxCount = MAX_SNAPSHOT_COUNT,
  snapshotMaxBytes = MAX_SNAPSHOT_BYTES,
  fullBackupMaxBytes = MAX_FULL_BACKUP_LOGICAL_BYTES,
} = {}) {
  for (const value of [
    snapshotMaxCount,
    snapshotMaxBytes,
    fullBackupMaxBytes,
  ])
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error("存储保留上限必须是正整数");
  if (snapshotMaxCount > MAX_SNAPSHOT_COUNT)
    throw new Error("快照数量不能超过完整备份支持的 50 份上限");
  return { snapshotMaxCount, snapshotMaxBytes, fullBackupMaxBytes };
}

// Rows arrive newest first. Keep a contiguous recent history, including the
// latest rollback even when that single snapshot exceeds the byte budget.
// Planning is read-only; callers choose when to apply the returned removals.
export function snapshotRetention(rows, policy) {
  let retainedCount = rows.length;
  let retainedBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  const totalBytes = retainedBytes;
  while (
    retainedCount > 1 &&
    (retainedCount > policy.snapshotMaxCount ||
      retainedBytes > policy.snapshotMaxBytes)
  ) {
    retainedCount--;
    retainedBytes -= rows[retainedCount].bytes;
  }
  return {
    fingerprint: createHash("sha256")
      .update(JSON.stringify(rows))
      .digest("hex"),
    removeIds: rows.slice(retainedCount).map((row) => row.id),
    retainedCount,
    retainedBytes,
    prunableCount: rows.length - retainedCount,
    prunableBytes: totalBytes - retainedBytes,
    oversizedLatest: (rows[0]?.bytes || 0) > policy.snapshotMaxBytes,
  };
}
