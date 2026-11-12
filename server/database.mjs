import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { stateSchema, emptyWorkspace } from "../src/domain.ts";
import { protectedBuilds, retainedBuildIds } from "./build-policy.mjs";
import { syncDeliveredKnowledge } from "../shared/knowledge-sync.mjs";
import { storagePolicy, snapshotRetention } from "./storage-policy.mjs";

export function openDatabase(directory, options = {}) {
  const policy = storagePolicy(options);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "workspace.sqlite");
  const db = new DatabaseSync(file);
  fs.chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER, body TEXT, at TEXT);
    CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, revision INTEGER, body TEXT, at TEXT, label TEXT);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, body TEXT);
    CREATE TABLE IF NOT EXISTS automations (project_id TEXT PRIMARY KEY, body TEXT);
    CREATE TABLE IF NOT EXISTS software_builds (id TEXT PRIMARY KEY, project_id TEXT, body TEXT);
  `);
  const read = () => {
    const row = db.prepare("SELECT * FROM workspace WHERE id=1").get();
    return row
      ? {
          state: stateSchema.parse(JSON.parse(row.body)),
          revision: row.revision,
          at: row.at,
        }
      : { state: null, revision: 0 };
  };
  const snapshotPlan = () =>
    snapshotRetention(
      db
        .prepare(
          "SELECT id, revision, length(CAST(body AS BLOB)) AS bytes FROM snapshots ORDER BY rowid DESC",
        )
        .all(),
      policy,
    );
  const applySnapshotPlan = (plan) => {
    const remove = db.prepare("DELETE FROM snapshots WHERE id=?");
    for (const id of plan.removeIds) remove.run(id);
  };
  const sizes = () =>
    Object.fromEntries(
      [
        ["workspace", "workspace"],
        ["snapshots", "snapshots"],
        ["builds", "software_builds"],
        ["runs", "runs"],
        ["automations", "automations"],
      ].map(([key, table]) => [
        key,
        {
          ...db
            .prepare(
              `SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(body AS BLOB))),0) AS bytes FROM ${table}`,
            )
            .get(),
        },
      ]),
    );
  const storageStatus = () => {
    // SQL byte lengths avoid loading/parsing project content, logs or sources.
    // This read never applies retention, including to an older/restored database.
    db.exec("BEGIN");
    try {
      const tables = sizes();
      const revision = db
        .prepare("SELECT revision FROM workspace WHERE id=1")
        .get()?.revision || 0;
      const logicalBytes = Object.values(tables).reduce(
        (sum, table) => sum + table.bytes,
        0,
      );
      const { removeIds: _ids, ...retention } = snapshotPlan();
      const withinLogicalLimit = logicalBytes <= policy.fullBackupMaxBytes;
      const warnings = [];
      if (!withinLogicalLimit)
        warnings.push(
          "当前逻辑数据超过完整备份上限；可先整理超额旧快照，仍超限时请使用 SQLite 在线备份。",
        );
      if (retention.prunableCount)
        warnings.push(
          `有 ${retention.prunableCount} 份旧快照超过保留上限，可确认后整理；读取状态和导出不会删除历史。`,
        );
      if (retention.oversizedLatest)
        warnings.push(
          "最新一份快照已超过快照字节预算，仍予保留以便回滚；整理不会删除这份快照。",
        );
      db.exec("COMMIT");
      return {
        revision,
        tables,
        fullBackup: {
          logicalBytes,
          logicalLimitBytes: policy.fullBackupMaxBytes,
          withinLogicalLimit,
        },
        snapshots: {
          maxCount: policy.snapshotMaxCount,
          maxBytes: policy.snapshotMaxBytes,
          keepLatest: true,
          ...retention,
        },
        canFullBackup: withinLogicalLimit,
        warning: warnings.join(" "),
      };
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  };
  const pruneSnapshots = (expected, snapshotFingerprint) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const revision = db
        .prepare("SELECT revision FROM workspace WHERE id=1")
        .get()?.revision || 0;
      if (revision !== expected)
        throw Object.assign(new Error("数据已变化，请刷新容量信息后再整理"), {
          status: 409,
        });
      const plan = snapshotPlan();
      if (plan.fingerprint !== snapshotFingerprint)
        throw Object.assign(new Error("快照已变化，请刷新容量信息后重新确认"), {
          status: 409,
        });
      applySnapshotPlan(plan);
      if (plan.prunableCount)
        db.prepare("UPDATE workspace SET revision=?, at=? WHERE id=1").run(
          revision + 1,
          new Date().toISOString(),
        );
      db.exec("COMMIT");
      return {
        removedCount: plan.prunableCount,
        removedBytes: plan.prunableBytes,
      };
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  };
  const snapshot = (label = "手动备份") => {
    const ownTransaction = !db.isTransaction;
    if (ownTransaction) db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT * FROM workspace WHERE id=1").get();
      let id = null;
      if (row) {
        id = randomUUID();
        db.prepare("INSERT INTO snapshots VALUES (?, ?, ?, ?, ?)").run(
          id,
          row.revision,
          row.body,
          new Date().toISOString(),
          label,
        );
        applySnapshotPlan(snapshotPlan());
      }
      if (ownTransaction) db.exec("COMMIT");
      return id;
    } catch (error) {
      if (ownTransaction && db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  };
  const save = (state, expected, label = "自动保存前快照") => {
    const parsed = stateSchema.parse(
      syncDeliveredKnowledge(stateSchema.parse(state)),
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = read();
      if (current.revision !== expected) {
        throw Object.assign(new Error("另一台设备已更新，请合并后再保存"), {
          status: 409,
        });
      }
      snapshot(label);
      const revision = current.revision + 1;
      const at = new Date().toISOString();
      db.prepare("INSERT OR REPLACE INTO workspace VALUES (1, ?, ?, ?)").run(
        revision,
        JSON.stringify(parsed),
        at,
      );
      db.exec("COMMIT");
      // Daily standalone JSON also survives accidental database replacement.
      const daily = path.join(directory, "daily-backups");
      const dailyFile = path.join(daily, `${at.slice(0, 10)}.json`);
      try {
        fs.mkdirSync(daily, { recursive: true, mode: 0o700 });
        if (!fs.existsSync(dailyFile))
          fs.writeFileSync(dailyFile, JSON.stringify(parsed), {
            mode: 0o600,
            flag: "wx",
          });
        for (const name of fs
          .readdirSync(daily)
          .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
          .sort()
          .reverse()
          .slice(30))
          fs.unlinkSync(path.join(daily, name));
      } catch (error) {
        console.error("每日备份写入失败:", error.message);
      }
      return { state: parsed, revision, at };
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  };
  const saveRun = (run) => {
    db.prepare(
      "INSERT INTO runs VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
    ).run(run.id, JSON.stringify(run));
    db.exec(
      "DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY rowid DESC LIMIT 100)",
    );
  };
  const listRuns = () =>
    db
      .prepare("SELECT body FROM runs ORDER BY rowid DESC LIMIT 100")
      .all()
      .map((r) => JSON.parse(r.body));
  for (const r of listRuns())
    if (r.status === "running")
      saveRun({
        ...r,
        status: "failed",
        error: "电脑服务重启，执行已中断",
        finishedAt: new Date().toISOString(),
      });
  const dump = () => {
    db.exec("BEGIN");
    try {
      const bytes = Object.values(sizes()).reduce(
        (sum, table) => sum + table.bytes,
        0,
      );
      if (bytes > policy.fullBackupMaxBytes)
        throw Object.assign(
          new Error(
            "备份数据超过容量上限，请整理超额旧快照或使用 SQLite 在线备份；未截断或删除任何数据",
          ),
          { status: 413 },
        );
      const current = read();
      const result = {
        workspace: current.state ? current : null,
        snapshots: db
          .prepare("SELECT * FROM snapshots ORDER BY rowid")
          .all()
          .map(({ body, ...r }) => ({ ...r, state: JSON.parse(body) })),
        runs: db
          .prepare("SELECT body FROM runs ORDER BY rowid")
          .all()
          .map((r) => JSON.parse(r.body)),
        automations: db
          .prepare("SELECT body FROM automations ORDER BY rowid")
          .all()
          .map((r) => JSON.parse(r.body)),
        builds: db
          .prepare("SELECT body FROM software_builds ORDER BY rowid")
          .all()
          .map((r) => JSON.parse(r.body)),
      };
      db.exec("COMMIT");
      return result;
    } catch (e) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw e;
    }
  };
  const restore = (data, expected) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (read().revision !== expected)
        throw Object.assign(new Error("数据已变化，请重新预览备份"), {
          status: 409,
        });
      for (const table of [
        "workspace",
        "snapshots",
        "runs",
        "automations",
        "software_builds",
      ])
        db.exec(`DELETE FROM ${table}`);
      // Monotonic revisions prevent an old browser from overwriting the restore.
      db.prepare("INSERT INTO workspace VALUES (1, ?, ?, ?)").run(
        expected + 1,
        JSON.stringify(data.workspace?.state || emptyWorkspace()),
        new Date().toISOString(),
      );
      for (const r of data.snapshots)
        db.prepare("INSERT INTO snapshots VALUES (?, ?, ?, ?, ?)").run(
          r.id,
          r.revision,
          JSON.stringify(r.state),
          r.at,
          r.label,
        );
      for (const r of data.runs)
        db.prepare("INSERT INTO runs VALUES (?, ?)").run(
          r.id,
          JSON.stringify(r),
        );
      for (const r of data.automations)
        db.prepare("INSERT INTO automations VALUES (?, ?)").run(
          r.projectId,
          JSON.stringify(r),
        );
      for (const r of data.builds)
        db.prepare("INSERT INTO software_builds VALUES (?, ?, ?)").run(
          r.id,
          r.projectId,
          JSON.stringify(r),
        );
      db.exec("COMMIT");
      return read();
    } catch (e) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw e;
    }
  };
  return {
    dump,
    restore,
    storageStatus,
    pruneSnapshots,
    saveBuild: (build) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "INSERT INTO software_builds VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
        ).run(build.id, build.projectId, JSON.stringify(build));
        const rows = db
          .prepare("SELECT body FROM software_builds ORDER BY rowid DESC")
          .all()
          .map((r) => JSON.parse(r.body));
        const keep = retainedBuildIds(rows, read().state);
        const remove = db.prepare("DELETE FROM software_builds WHERE id=?");
        for (const row of rows) if (!keep.has(row.id)) remove.run(row.id);
        db.exec("COMMIT");
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    },
    protectedBuildIds: () =>
      protectedBuilds(
        db
          .prepare("SELECT body FROM software_builds ORDER BY rowid DESC")
          .all()
          .map((r) => JSON.parse(r.body)),
        read().state,
      ),
    getBuild: (id) => {
      const r = db
        .prepare("SELECT body FROM software_builds WHERE id=?")
        .get(id);
      return r ? JSON.parse(r.body) : null;
    },
    listBuilds: (projectId) =>
      (projectId
        ? db
            .prepare(
              "SELECT body FROM software_builds WHERE project_id=? ORDER BY rowid DESC",
            )
            .all(projectId)
        : db
            .prepare("SELECT body FROM software_builds ORDER BY rowid DESC")
            .all()
      ).map((r) => JSON.parse(r.body)),
    read,
    save,
    snapshot,
    saveRun,
    listRuns,
    listAutomations: () =>
      db
        .prepare("SELECT body FROM automations")
        .all()
        .map((r) => JSON.parse(r.body)),
    saveAutomation: (job) =>
      db
        .prepare("INSERT OR REPLACE INTO automations VALUES (?, ?)")
        .run(job.projectId, JSON.stringify(job)),
    backups: () =>
      db
        .prepare(
          "SELECT id, revision, at, label, length(CAST(body AS BLOB)) AS size FROM snapshots ORDER BY rowid DESC",
        )
        .all(),
    backup: (id) => {
      const r = db.prepare("SELECT body FROM snapshots WHERE id=?").get(id);
      return r ? stateSchema.parse(JSON.parse(r.body)) : null;
    },
    close: () => db.close(),
  };
}
