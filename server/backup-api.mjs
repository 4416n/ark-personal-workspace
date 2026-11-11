import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  encodeFullBackup,
  decodeFullBackup,
  backupDigest,
  MAX_BACKUP_BYTES,
  MAX_BACKUP_RAW_BYTES,
} from "./full-backup.mjs";
const route = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export function backupApi(
  app,
  { database, access, dataDir, idle, afterRestore },
) {
  let pending = null,
    busy = false,
    closed = false;
  const clear = () => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  };
  const assertIdle = () => {
    if (!idle())
      throw fail("请先停止所有 AI/工程执行，等待结束后再整理快照或迁移备份", 409);
  };
  const requireDb = (_req, _res, next) =>
    database ? next() : next(fail("完整备份需要电脑共享模式"));
  app.use("/api", (_req, res, next) =>
    busy
      ? res
          .status(423)
          .json({ error: "正在恢复完整备份，请等待完成并刷新页面" })
      : next(),
  );
  const storageStatus = () => {
    const status = database.storageStatus();
    return {
      ...status,
      fullBackup: {
        ...status.fullBackup,
        rawLimitBytes: MAX_BACKUP_RAW_BYTES,
        compressedLimitBytes: MAX_BACKUP_BYTES,
      },
      note:
        "此处统计备份内容的大小，不等于数据库的磁盘占用。实际导出还需满足原始档案 256 MiB、压缩档案 64 MiB 的限制。",
    };
  };
  app.get(
    "/api/storage-status",
    access.localOnly,
    requireDb,
    route(async (_req, res) => res.json(storageStatus())),
  );
  app.post(
    "/api/snapshots/prune",
    access.localOnly,
    requireDb,
    route(async (req, res) => {
      const { revision, snapshotFingerprint } = z
        .object({
          confirmed: z.literal(true),
          revision: z.number().int().min(0),
          snapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .parse(req.body);
      assertIdle();
      const result = database.pruneSnapshots(revision, snapshotFingerprint);
      if (result.removedCount) clear();
      res.json({ ok: true, ...result, status: storageStatus() });
    }),
  );
  app.get(
    "/api/full-backup",
    access.localOnly,
    requireDb,
    route(async (_req, res) => {
      const bytes = encodeFullBackup(database.dump());
      res
        .set({
          "Content-Type": "application/gzip",
          "Content-Disposition":
            'attachment; filename="ark-workspace.arkbackup.gz"',
          "Cache-Control": "no-store",
        })
        .send(bytes);
    }),
  );
  app.post(
    "/api/full-backup/preview",
    access.localOnly,
    requireDb,
    express.raw({ type: "application/gzip", limit: "64mb" }),
    route(async (req, res) => {
      assertIdle();
      if (pending?.decoding) throw fail("正在校验另一份备份，请稍后重试", 409);
      clear();
      pending = { decoding: true };
      try {
        const result = await decodeFullBackup(req.body);
        if (closed) throw fail("服务已停止", 503);
        assertIdle();
        const token = randomUUID(),
          expiresAt = Date.now() + 10 * 60000;
        pending = {
          ...result,
          token,
          expiresAt,
          fingerprint: backupDigest(database.dump()),
          timer: setTimeout(clear, 10 * 60000),
        };
        pending.timer.unref?.();
        res.json({
          token,
          expiresAt,
          createdAt: result.createdAt,
          checksum: result.checksum,
          counts: result.counts,
        });
      } catch (error) {
        clear();
        throw Object.assign(error, { status: error.status || 400 });
      }
    }),
  );
  app.post(
    "/api/full-backup/restore",
    access.localOnly,
    requireDb,
    route(async (req, res) => {
      const { token, confirmed, revision } = z
        .object({
          token: z.string().uuid(),
          confirmed: z.literal(true),
          revision: z.number().int().min(0),
        })
        .parse(req.body);
      if (
        !confirmed ||
        !pending?.data ||
        token !== pending.token ||
        Date.now() > pending.expiresAt
      )
        throw fail("预览已失效，请重新选择备份文件");
      assertIdle();
      const current = database.dump();
      if (
        (current.workspace?.revision || 0) !== revision ||
        backupDigest(current) !== pending.fingerprint
      )
        throw fail(
          "预览后数据或执行记录已变化，请重新预览，不会覆盖新的修改",
          409,
        );
      const prepared = pending;
      busy = true;
      try {
        const backupName = `before-restore-${Date.now()}-${randomUUID()}.arkbackup.gz`;
        const directory = path.join(dataDir, "full-backups");
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const handle = await fs.open(
          path.join(directory, backupName),
          "wx",
          0o600,
        );
        try {
          await handle.writeFile(encodeFullBackup(current));
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (process.platform !== "win32") {
          const parent = await fs.open(directory, "r");
          try {
            await parent.sync();
          } finally {
            await parent.close();
          }
        }
        if (closed) throw fail("服务已停止", 503);
        assertIdle();
        if (backupDigest(database.dump()) !== prepared.fingerprint)
          throw fail("数据已变化，请重新预览", 409);
        const saved = database.restore(prepared.data, revision);
        afterRestore();
        access.revoke();
        clear();
        res.json({
          ok: true,
          revision: saved.revision,
          safetyBackup: backupName,
        });
      } finally {
        busy = false;
      }
    }),
  );
  return {
    close: () => {
      closed = true;
      clear();
    },
  };
}
