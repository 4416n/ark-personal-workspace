import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { z } from "zod";
import { openDatabase } from "../server/database.mjs";
import { backupApi } from "../server/backup-api.mjs";
import { accessControl, lanAddresses } from "../server/access.mjs";
import { emptyWorkspace, seedWorkspace } from "../src/domain.ts";
import {
  MAX_SNAPSHOT_BYTES,
  MAX_FULL_BACKUP_LOGICAL_BYTES,
} from "../server/storage-policy.mjs";
import {
  encodeFullBackup,
  decodeFullBackup,
} from "../server/full-backup.mjs";

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value));
async function directory() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-storage-"));
  const cleanup = async () => {
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("ark-storage-"));
    await fs.rm(resolved, { recursive: true, force: true });
  };
  return { dir, cleanup };
}
async function database(options) {
  const { dir, cleanup } = await directory();
  const db = openDatabase(dir, options);
  return { dir, db, cleanup };
}
function insertLegacySnapshots(dir, state, count) {
  const raw = new DatabaseSync(path.join(dir, "workspace.sqlite"));
  try {
    raw.exec("BEGIN IMMEDIATE");
    const insert = raw.prepare("INSERT INTO snapshots VALUES (?, ?, ?, ?, ?)");
    for (let i = 0; i < count; i++)
      insert.run(
        `legacy-${i}`,
        1,
        JSON.stringify(state),
        new Date().toISOString(),
        `旧快照 ${i}`,
      );
    raw.exec("COMMIT");
  } finally {
    raw.close();
  }
}
async function apiFixture(t) {
  const state = seedWorkspace();
  state.profile.name = "容量正文不应出现在统计接口";
  const { dir, db, cleanup } = await database({
    snapshotMaxBytes: byteLength(state) * 3,
  });
  db.save(state, 0);
  const saved = db.read();
  insertLegacySnapshots(dir, saved.state, 6);
  const app = express();
  const access = accessControl({
    lan: true,
    shared: true,
    initialized: () => true,
  });
  app.use("/api", access.guard);
  app.use(express.json());
  access.install(app);
  let active = false;
  const backups = backupApi(app, {
    database: db,
    access,
    dataDir: dir,
    idle: () => !active,
    afterRestore: () => {},
  });
  app.use((error, _req, res, _next) =>
    res.status(error instanceof z.ZodError ? 400 : error.status || 500).json({
      error: error.message,
    }),
  );
  const server = app.listen(0, "0.0.0.0");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, body, headers = {}) =>
    fetch((headers.host ? `http://${headers.host}` : base) + "/api" + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined
          ? {}
          : {
              "Content-Type": Buffer.isBuffer(body)
                ? "application/gzip"
                : "application/json",
            }),
        ...headers,
      },
      body:
        body === undefined
          ? undefined
          : Buffer.isBuffer(body)
            ? body
            : JSON.stringify(body),
    });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    backups.close();
    db.close();
    await cleanup();
  });
  return {
    dir,
    db,
    request,
    port: server.address().port,
    setActive: (value) => {
      active = value;
    },
  };
}

test("a real 5 MiB workspace remains fully exportable after 55 saves", async (t) => {
  const { dir, db, cleanup } = await database();
  try {
    const state = emptyWorkspace();
    // 18 independent 100k-character notes are valid application inputs. UTF-8
    // makes this >5 MiB, so the old 50-copy policy would exceed 250 MiB.
    state.knowledge = Array.from({ length: 18 }, (_, i) => ({
      id: `large-note-${i}`,
      title: `资料 ${i}`,
      content: "中".repeat(100000),
      category: "资料",
      updatedAt: new Date().toISOString(),
    }));
    const originalBytes = byteLength(state);
    assert.ok(originalBytes > 5 * 1024 * 1024);
    assert.ok(originalBytes * 51 > MAX_FULL_BACKUP_LOGICAL_BYTES);
    for (let revision = 0; revision < 55; revision++) {
      state.profile.focus = String(revision);
      db.save(state, revision);
    }
    const status = db.storageStatus();
    assert.ok(status.tables.snapshots.bytes <= MAX_SNAPSHOT_BYTES);
    assert.ok(status.tables.snapshots.count > 1);
    assert.equal(status.canFullBackup, true);
    assert.equal(status.snapshots.prunableCount, 0);
    assert.equal(db.read().state.profile.focus, "54");
    assert.equal(db.backup(db.backups()[0].id).profile.focus, "53");
    const decoded = await decodeFullBackup(encodeFullBackup(db.dump()));
    assert.equal(decoded.data.workspace.state.knowledge.length, 18);
    assert.equal(decoded.counts.snapshots, status.tables.snapshots.count);
    assert.equal(decoded.data.workspace.state.profile.focus, "54");
    assert.ok((await fs.readdir(path.join(dir, "daily-backups"))).length);
  } finally {
    db.close();
    await cleanup();
  }
});

test("count retention keeps the newest 50; a single oversized snapshot remains usable", async (t) => {
  const { db, cleanup } = await database();
  try {
    db.save(emptyWorkspace(), 0);
    for (let i = 0; i < 55; i++) db.snapshot(`snapshot ${i}`);
    assert.equal(db.backups().length, 50);
    assert.equal(db.backups()[0].label, "snapshot 54");
    assert.equal(db.backups().at(-1).label, "snapshot 5");
  } finally {
    db.close();
    await cleanup();
  }
  const oversized = await database({ snapshotMaxBytes: 1 });
  try {
    const state = emptyWorkspace();
    oversized.db.save(state, 0);
    oversized.db.snapshot("older");
    const latest = oversized.db.snapshot("latest rollback");
    const status = oversized.db.storageStatus();
    assert.equal(status.tables.snapshots.count, 1);
    assert.equal(status.snapshots.oversizedLatest, true);
    assert.equal(status.snapshots.prunableCount, 0);
    assert.match(status.warning, /仍予保留/);
    assert.deepEqual(oversized.db.backup(latest), state);
    assert.equal(
      oversized.db.pruneSnapshots(1, status.snapshots.fingerprint).removedCount,
      0,
    );
    assert.equal(oversized.db.read().revision, 1);
    assert.ok(oversized.db.backup(latest));
  } finally {
    oversized.db.close();
    await oversized.cleanup();
  }
});

test("legacy excess is read-only until explicit pruning; totals count UTF-8 bytes and protect other data", async (t) => {
  const state = emptyWorkspace();
  state.profile.name = "中文状态";
  const size = byteLength(state);
  const { dir, db, cleanup } = await database({
    snapshotMaxBytes: size * 2,
    fullBackupMaxBytes: size * 5,
  });
  try {
    db.save(state, 0);
    insertLegacySnapshots(dir, state, 6);
    const run = { id: "run", status: "succeeded", output: { content: "记录" } };
    const job = { projectId: "project", status: "paused" };
    const stable = {
      id: randomUUID(),
      projectId: "project",
      status: "verified",
      files: [{ path: "README.md", content: "稳定工程" }],
    };
    const pinned = { ...stable, id: randomUUID(), pinned: true };
    db.saveRun(run);
    db.saveAutomation(job);
    db.saveBuild(stable);
    db.saveBuild(pinned);
    const safetyDir = path.join(dir, "full-backups");
    await fs.mkdir(safetyDir);
    const safety = path.join(safetyDir, "before-restore.arkbackup.gz");
    await fs.writeFile(safety, "independent safety backup");
    const before = db.backups();
    // A status request must not parse stored JSON bodies or expose them.
    const parse = JSON.parse;
    let status;
    try {
      JSON.parse = () => {
        throw new Error("storage status must not parse JSON bodies");
      };
      status = db.storageStatus();
    } finally {
      JSON.parse = parse;
    }
    assert.deepEqual(status.tables.workspace, { count: 1, bytes: size });
    assert.deepEqual(status.tables.snapshots, { count: 6, bytes: size * 6 });
    assert.deepEqual(status.tables.runs, { count: 1, bytes: byteLength(run) });
    assert.deepEqual(status.tables.automations, {
      count: 1,
      bytes: byteLength(job),
    });
    assert.deepEqual(status.tables.builds, {
      count: 2,
      bytes: byteLength(stable) + byteLength(pinned),
    });
    assert.equal(
      status.fullBackup.logicalBytes,
      size * 7 +
        byteLength(run) +
        byteLength(job) +
        byteLength(stable) +
        byteLength(pinned),
    );
    assert.equal(status.canFullBackup, false);
    assert.equal(JSON.stringify(status).includes(state.profile.name), false);
    assert.throws(() => db.dump(), (error) => error.status === 413);
    assert.deepEqual(db.backups(), before);
    assert.throws(() => db.pruneSnapshots(0), (error) => error.status === 409);
    assert.deepEqual(db.backups(), before);
    const removed = db.pruneSnapshots(1, status.snapshots.fingerprint);
    assert.deepEqual(removed, { removedCount: 4, removedBytes: size * 4 });
    assert.deepEqual(
      db.backups().map((row) => row.id),
      ["legacy-5", "legacy-4"],
    );
    assert.deepEqual(db.read().state, state);
    assert.equal(db.read().revision, 2);
    assert.deepEqual(db.getBuild(stable.id), stable);
    assert.deepEqual(db.getBuild(pinned.id), pinned);
    assert.deepEqual(db.listRuns(), [run]);
    assert.deepEqual(db.listAutomations(), [job]);
    assert.equal(await fs.readFile(safety, "utf8"), "independent safety backup");
    assert.equal(db.storageStatus().canFullBackup, true);
    assert.equal(db.dump().snapshots.length, 2);
  } finally {
    db.close();
    await cleanup();
  }
});

test("opening and restoring existing history never applies the new retention implicitly", async (t) => {
  const { dir, db, cleanup } = await database();
  const state = emptyWorkspace();
  db.save(state, 0);
  insertLegacySnapshots(dir, state, 5);
  const archived = db.dump();
  db.close();
  const reopened = openDatabase(dir, { snapshotMaxBytes: byteLength(state) * 2 });
  try {
    assert.equal(reopened.storageStatus().tables.snapshots.count, 5);
    assert.equal(reopened.storageStatus().snapshots.prunableCount, 3);
    assert.equal(reopened.dump().snapshots.length, 5);
    reopened.restore(archived, 1);
    assert.equal(reopened.read().revision, 2);
    assert.equal(reopened.storageStatus().tables.snapshots.count, 5);
    assert.equal(reopened.dump().snapshots.length, 5);
    reopened.snapshot("explicit new snapshot uses current retention");
    assert.equal(reopened.storageStatus().tables.snapshots.count, 2);
    assert.equal(
      reopened.backups()[0].label,
      "explicit new snapshot uses current retention",
    );
  } finally {
    reopened.close();
    await cleanup();
  }
});

test("storage APIs require confirmation, an unchanged revision, idle execution and local access", async (t) => {
  const f = await apiFixture(t);
  const response = await f.request("/storage-status");
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(
    status.fullBackup.logicalLimitBytes,
    MAX_FULL_BACKUP_LOGICAL_BYTES,
  );
  assert.equal(status.fullBackup.rawLimitBytes, 256 * 1024 * 1024);
  assert.equal(status.fullBackup.compressedLimitBytes, 64 * 1024 * 1024);
  assert.equal(status.tables.snapshots.count, 6);
  assert.ok(status.snapshots.prunableCount > 0);
  assert.equal(
    JSON.stringify(status).includes("容量正文不应出现在统计接口"),
    false,
  );
  const before = f.db.backups();
  const confirmation = {
    confirmed: true,
    revision: status.revision,
    snapshotFingerprint: status.snapshots.fingerprint,
  };
  for (const body of [
    { revision: status.revision },
    { confirmed: false, revision: status.revision },
  ])
    assert.equal((await f.request("/snapshots/prune", body)).status, 400);
  assert.equal(
    (
      await f.request("/snapshots/prune", {
        confirmed: true,
        revision: status.revision,
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.request("/snapshots/prune", { ...confirmation, revision: 0 })).status,
    409,
  );
  f.setActive(true);
  assert.equal(
    (await f.request("/snapshots/prune", confirmation)).status,
    409,
  );
  f.setActive(false);
  assert.deepEqual(f.db.backups(), before);
  const address = lanAddresses()[0]?.address;
  if (address) {
    const headers = { host: `${address}:${f.port}` };
    assert.equal(
      (await f.request("/storage-status", undefined, headers)).status,
      401,
    );
    const { code } = await (await f.request("/connection/code", {})).json();
    const paired = await f.request("/pair", { code }, headers);
    assert.equal(paired.status, 200);
    headers.cookie = paired.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (await f.request("/storage-status", undefined, headers)).status,
      403,
    );
    assert.equal(
      (await f.request("/snapshots/prune", confirmation, headers)).status,
      403,
    );
  } else {
    t.diagnostic("No LAN interface: paired-mobile branch cannot run on this host");
  }
  const prunedResponse = await f.request("/snapshots/prune", confirmation);
  assert.equal(prunedResponse.status, 200);
  const pruned = await prunedResponse.json();
  assert.equal(pruned.ok, true);
  assert.equal(pruned.removedCount, status.snapshots.prunableCount);
  assert.equal(pruned.removedBytes, status.snapshots.prunableBytes);
  assert.equal(pruned.status.revision, status.revision + 1);
  assert.equal(pruned.status.snapshots.prunableCount, 0);
  assert.equal(
    (await f.request("/snapshots/prune", confirmation)).status,
    409,
  );
});

test("a manual snapshot invalidates an earlier prune confirmation even without a workspace revision change", async (t) => {
  const f = await apiFixture(t);
  const status = await (await f.request("/storage-status")).json();
  f.db.snapshot("created after storage preview");
  const current = f.db.storageStatus();
  assert.equal(current.revision, status.revision);
  assert.notEqual(current.snapshots.fingerprint, status.snapshots.fingerprint);
  const before = f.db.backups();
  const response = await f.request("/snapshots/prune", {
    confirmed: true,
    revision: status.revision,
    snapshotFingerprint: status.snapshots.fingerprint,
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /快照已变化/);
  assert.deepEqual(f.db.backups(), before);
});

test("restore busy protection blocks pruning; imported excess remains until a new confirmation", async (t) => {
  const f = await apiFixture(t);
  const archive = Buffer.from(
    await (await f.request("/full-backup")).arrayBuffer(),
  );
  const previewResponse = await f.request("/full-backup/preview", archive);
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  const before = f.db.backups();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const open = fs.open;
  fs.open = async (name, ...args) => {
    if (path.dirname(String(name)) === path.join(f.dir, "full-backups")) {
      entered.resolve();
      await release.promise;
    }
    return open(name, ...args);
  };
  let restoring;
  try {
    restoring = f.request("/full-backup/restore", {
      confirmed: true,
      revision: 1,
      token: preview.token,
    });
    await entered.promise;
    assert.equal((await f.request("/storage-status")).status, 423);
    assert.equal(
      (await f.request("/snapshots/prune", { confirmed: true, revision: 1 })).status,
      423,
    );
    assert.deepEqual(f.db.backups(), before);
  } finally {
    fs.open = open;
    release.resolve();
  }
  const response = await restoring;
  assert.equal(response.status, 200);
  const restored = await response.json();
  const status = await (await f.request("/storage-status")).json();
  assert.equal(status.tables.snapshots.count, before.length);
  assert.ok(status.snapshots.prunableCount > 0);
  assert.equal(status.revision, 2);
  assert.ok(await fs.stat(path.join(f.dir, "full-backups", restored.safetyBackup)));
});
