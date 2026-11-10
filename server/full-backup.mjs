import { z } from "zod";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { MAX_BUILD_PINS } from "./build-policy.mjs";
import { stateSchema, passageSchema } from "../src/domain.ts";
import {
  parseBundle,
  assembleBundle,
  sourceFiles,
  sourceHash,
  platformFiles,
} from "./project-bundle.mjs";

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
export const MAX_BACKUP_RAW_BYTES = 256 * 1024 * 1024;
const id = z.string().min(1).max(100);
const at = z.string().datetime();
const record = z.object({}).passthrough();
const check = z
  .object({
    name: z.string().max(1000),
    passed: z.boolean(),
    detail: z.string().max(100000).default(""),
  })
  .passthrough();
const run = z
  .object({
    id,
    status: z.string().max(50),
    kind: z.string().max(60).default("imported"),
    label: z.string().max(200).default("恢复的执行记录"),
    startedAt: at,
    sources: z.array(passageSchema).max(6).default([]),
    endpoint: z.string().max(200).default(""),
    model: z.string().max(150).optional(),
    provider: z.string().max(150).optional(),
    error: z.string().max(100000).optional(),
    finishedAt: at.optional(),
    input: record.optional(),
    output: z
      .object({
        content: z.string().max(700000).optional(),
        tasks: z.array(record).max(100).optional(),
      })
      .passthrough()
      .optional(),
    usage: z
      .object({
        input: z.number().min(0),
        output: z.number().min(0),
        total: z.number().min(0),
      })
      .nullable()
      .optional(),
  })
  .passthrough();
const job = z
  .object({
    id,
    projectId: id,
    status: z.string().max(50),
    taskIds: z.array(id).max(100),
    usedCalls: z.number().int().min(0).max(100),
    maxCalls: z.number().int().min(0).max(100),
    title: z.string().max(200).default("恢复的执行批次"),
    note: z.string().max(100000).default(""),
    mode: z.enum(["auto", "manual"]).default("manual"),
    maxReworks: z.number().int().min(0).max(2).default(0),
    events: z
      .array(z.object({ at, text: z.string().max(100000) }))
      .max(100)
      .default([]),
  })
  .passthrough();
const build = z
  .object({
    id: z.string().uuid(),
    projectId: id,
    title: z.string().max(200),
    status: z.string().max(50),
    startedAt: at,
    files: z
      .array(
        z.object({
          path: z.string().max(180),
          content: z.string().max(700000),
        }),
      )
      .max(80),
    summary: z.string().max(3000).default(""),
    error: z.string().max(100000).default(""),
    sourceHash: z.string().regex(/^(?:[a-f0-9]{64})?$/),
    requirementsHash: z.string().regex(/^[a-f0-9]{64}$/),
    requirementsVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    mode: z.enum(["generate", "validate"]).optional(),
    sourceOrigin: z
      .object({
        id: z.string().uuid(),
        sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        startedAt: at.nullable(),
      })
      .optional(),
    baseBuildId: z.string().uuid().nullable().optional(),
    baseSourceHash: z.string().max(64).nullable().optional(),
    maxRepairs: z.number().int().min(0).max(2).default(0),
    attempt: z.number().int().min(0).max(3).default(0),
    validation: z
      .object({
        passed: z.boolean(),
        checks: z.array(check).max(100),
        logs: z.string().max(100000).default(""),
        scope: z.string().max(10000).optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    screenshot: z.string().max(5000000).nullable().optional(),
    restoredScreenshot: z.string().max(5000000).nullable().optional(),
    restoredStatus: z.string().max(50).optional(),
    pinned: z.boolean().optional(),
    attempts: z
      .array(
        z
          .object({
            number: z.number(),
            passed: z.boolean(),
            logs: z.string().max(100000).default(""),
            checks: z.array(check).max(100).default([]),
          })
          .passthrough(),
      )
      .max(100)
      .default([]),
  })
  .passthrough();
export const backupDataSchema = z.object({
  workspace: z
    .object({
      state: stateSchema,
      revision: z.number().int().min(0),
      at: z.string(),
    })
    .nullable(),
  snapshots: z
    .array(
      z.object({
        id,
        revision: z.number().int().min(0),
        state: stateSchema,
        at,
        label: z.string().max(1000),
      }),
    )
    .max(50),
  runs: z.array(run).max(100),
  automations: z.array(job).max(2000),
  builds: z.array(build).max(5000),
});
export const backupDigest = (data) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
export function encodeFullBackup(data) {
  const body = JSON.stringify({
    format: "ark-full-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    checksum: backupDigest(data),
    data,
  });
  if (Buffer.byteLength(body) > MAX_BACKUP_RAW_BYTES)
    throw new Error(
      "完整备份超过 256 MB，请先整理历史或使用本机 SQLite 在线备份；未截断数据",
    );
  const compressed = gzipSync(body);
  if (compressed.length > MAX_BACKUP_BYTES)
    throw new Error(
      "压缩备份超过 64 MB；未截断数据，请使用本机 SQLite 在线备份",
    );
  return compressed;
}
export async function decodeFullBackup(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BACKUP_BYTES)
    throw new Error("备份文件应为 64 MB 以内的 .arkbackup.gz 文件");
  let envelope;
  try {
    envelope = JSON.parse(
      gunzipSync(bytes, { maxOutputLength: MAX_BACKUP_RAW_BYTES }).toString(
        "utf8",
      ),
    );
  } catch {
    throw new Error("备份无法解压、超过容量限制或不是有效 JSON；数据未修改");
  }
  if (envelope?.format !== "ark-full-backup" || envelope.version !== 1)
    throw new Error("不支持的完整备份格式或版本");
  if (envelope.checksum !== backupDigest(envelope.data))
    throw new Error("备份校验和不一致，文件可能损坏；数据未修改");
  const parsed = backupDataSchema.safeParse(envelope.data);
  if (!parsed.success)
    throw new Error("备份数据结构或关联格式无效；数据未修改");
  if (!at.safeParse(envelope.createdAt).success)
    throw new Error("备份创建时间无效");
  const data = parsed.data;
  if (data.builds.filter((b) => b.pinned).length > MAX_BUILD_PINS)
    throw new Error("备份锁定版本超过上限");
  for (const [key, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    const ids = rows.map((r) => (key === "automations" ? r.projectId : r.id));
    if (new Set(ids).size !== ids.length)
      throw new Error("备份包含重复记录；数据未修改");
  }
  const now = new Date().toISOString();
  data.runs = data.runs.map((r) =>
    r.status === "running"
      ? {
          ...r,
          status: "cancelled",
          error: "从备份恢复，原执行已中断，未重新调用模型",
          finishedAt: now,
        }
      : r,
  );
  data.automations = data.automations.map((j) => ({
    ...j,
    status: j.status === "completed" ? "completed" : "paused",
    note: "从备份恢复；确认后才能重新执行，不会自动消耗额度",
  }));
  for (const b of data.builds) {
    if (b.files.length) {
      const allowed = new Set([
        ...sourceFiles(b.files).map((f) => f.path),
        ...platformFiles,
      ]);
      if (
        new Set(b.files.map((f) => f.path)).size !== b.files.length ||
        b.files.some((f) => !allowed.has(f.path))
      )
        throw new Error("工程文件路径非法或重复，拒绝恢复");
      // Never execute a harness imported from a file, even if its checksum matches.
      const tests = b.files.find((f) => f.path === "tests/acceptance.json");
      const bundle = parseBundle(
        JSON.stringify({
          summary: b.summary || "恢复的工程",
          files: sourceFiles(b.files),
          tests: JSON.parse(tests?.content || "null"),
        }),
      );
      b.files = await assembleBundle(bundle);
    }
    b.originalSourceHash = b.originalSourceHash || b.sourceHash;
    b.sourceHash = b.files.length ? sourceHash(b.files) : "";
    b.restoredStatus = b.restoredStatus || b.status;
    b.status = "restored";
    b.restoredAt = now;
    b.restoredValidation = b.restoredValidation || b.validation || null;
    b.restoredScreenshot = b.restoredScreenshot || b.screenshot || null;
    b.validation = null;
    b.screenshot = null;
    b.error = "从备份恢复；历史报告不能替代本机重验，未执行源码或调用模型";
  }
  return {
    data,
    checksum: envelope.checksum,
    createdAt: envelope.createdAt,
    counts: {
      projects: data.workspace?.state.projects.length || 0,
      tasks: data.workspace?.state.tasks.length || 0,
      knowledge: data.workspace?.state.knowledge.length || 0,
      templates: data.workspace?.state.templates?.length || 0,
      builds: data.builds.length,
      runs: data.runs.length,
      automations: data.automations.length,
      snapshots: data.snapshots.length,
    },
  };
}
