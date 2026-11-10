import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { stateSchema } from "../src/domain.ts";
import { syncDeliveredKnowledge } from "../shared/knowledge-sync.mjs";

export function openDatabase(directory) {
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
  const snapshot = (label = "手动备份") => {
    const row = db.prepare("SELECT * FROM workspace WHERE id=1").get();
    if (!row) return null;
    const id = randomUUID();
    db.prepare("INSERT INTO snapshots VALUES (?, ?, ?, ?, ?)").run(
      id,
      row.revision,
      row.body,
      new Date().toISOString(),
      label,
    );
    db.exec(
      "DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY rowid DESC LIMIT 50)",
    );
    return id;
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
  return {
    saveBuild: (build) => {
      db.prepare(
        "INSERT INTO software_builds VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      ).run(build.id, build.projectId, JSON.stringify(build));
      db.prepare(
        "DELETE FROM software_builds WHERE project_id=? AND id NOT IN (SELECT id FROM software_builds WHERE project_id=? ORDER BY rowid DESC LIMIT 5)",
      ).run(build.projectId, build.projectId);
      db.exec(
        "DELETE FROM software_builds WHERE id NOT IN (SELECT id FROM software_builds ORDER BY rowid DESC LIMIT 30)",
      );
    },
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
          "SELECT id, revision, at, label, length(body) AS size FROM snapshots ORDER BY rowid DESC",
        )
        .all(),
    backup: (id) => {
      const r = db.prepare("SELECT body FROM snapshots WHERE id=?").get(id);
      return r ? stateSchema.parse(JSON.parse(r.body)) : null;
    },
    close: () => db.close(),
  };
}
