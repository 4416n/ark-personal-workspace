import { requirements, requirementsHash } from "./requirements.mjs";

// Source age and validation-record age are deliberately different.
export const MAX_BUILD_PINS = 20;
export const isBuildRunning = (build) =>
  ["generating", "validating", "cancelling"].includes(build.status);
const stable = (b) =>
  b.status === "verified" ||
  (b.pipeline &&
    b.validation?.passed &&
    b.validation.sourceHash === b.sourceHash) ||
  (b.status === "restored" && b.restoredStatus === "verified");

export function sourceOrigin(build, rows) {
  const byId = rows instanceof Map ? rows : new Map(rows.map((b) => [b.id, b]));
  const seen = new Set();
  let current = build;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.sourceOrigin) return current.sourceOrigin;
    if (current.mode !== "validate")
      return {
        id: current.id,
        sequence: 0,
        startedAt: current.startedAt || null,
      };
    const parent = byId.get(current.baseBuildId);
    if (!parent || parent.projectId !== build.projectId) break;
    current = parent;
  }
  // Old dangling validation chains are unknown, never "new source" today.
  return { id: current?.baseBuildId || build.id, sequence: 0, startedAt: null };
}

export function nextSourceSequence(rows) {
  const next =
    rows.reduce((n, b) => Math.max(n, b.sourceOrigin?.sequence || 0), 0) + 1;
  if (!Number.isSafeInteger(next))
    throw new Error("源码代次超出有效范围，请检查备份来源");
  return next;
}

export function buildSelection(newestFirst, state) {
  const protectedIds = new Set(),
    baselines = new Map(),
    recommended = new Map();
  const indexes = new Map(newestFirst.map((b, i) => [b.id, i]));
  const byId = new Map(newestFirst.map((b) => [b.id, b]));
  const projectIds = new Set(state?.projects.map((p) => p.id) || []);
  const hashes = new Map();
  const current = (b) => {
    if (!projectIds.has(b.projectId)) return false;
    const key = `${b.projectId}:${b.requirementsVersion || 1}`;
    if (!hashes.has(key))
      hashes.set(
        key,
        requirementsHash(
          requirements(state, b.projectId),
          b.requirementsVersion || 1,
        ),
      );
    return b.requirementsHash === hashes.get(key);
  };
  const ranked = newestFirst
    .map((build) => ({ build, origin: sourceOrigin(build, byId) }))
    .sort(
      (a, b) =>
        b.origin.sequence - a.origin.sequence ||
        (Date.parse(b.origin.startedAt) || 0) -
          (Date.parse(a.origin.startedAt) || 0) ||
        (indexes.get(a.origin.id) ?? Infinity) -
          (indexes.get(b.origin.id) ?? Infinity) ||
        indexes.get(a.build.id) - indexes.get(b.build.id),
    )
    .map((r) => r.build);
  for (const b of newestFirst)
    if (b.pinned || isBuildRunning(b)) protectedIds.add(b.id);
  for (const b of ranked) {
    if (!b.files?.length || isBuildRunning(b)) continue;
    if (stable(b) && !baselines.has(b.projectId)) {
      baselines.set(b.projectId, b);
      protectedIds.add(b.id);
    }
    if (
      b.status === "verified" &&
      current(b) &&
      !recommended.has(b.projectId)
    ) {
      recommended.set(b.projectId, b);
      protectedIds.add(b.id);
    }
  }
  // Prefer a source-stable baseline, never the last validation record by date.
  for (const [id, b] of baselines)
    if (!recommended.has(id)) recommended.set(id, b);
  for (const b of ranked)
    if (b.files?.length && !isBuildRunning(b) && !recommended.has(b.projectId))
      recommended.set(b.projectId, b);
  return { protectedIds, baselines, recommended };
}
export const protectedBuilds = (rows, state) =>
  buildSelection(rows, state).protectedIds;
export function retainedBuildIds(newestFirst, state) {
  const keep = protectedBuilds(newestFirst, state);
  const perProject = new Map();
  let ordinary = 0;
  for (const build of newestFirst) {
    const count = perProject.get(build.projectId) || 0;
    perProject.set(build.projectId, count + 1);
    if (count < 5 && ordinary < 30) {
      keep.add(build.id);
      ordinary++;
    }
  }
  return keep;
}
