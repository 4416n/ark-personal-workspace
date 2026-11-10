import { test } from "node:test";
import assert from "node:assert/strict";
import {
  retainedBuildIds,
  buildSelection,
  sourceOrigin,
} from "../server/build-policy.mjs";
import {
  requirements,
  requirementsHash,
  hashInput,
} from "../server/requirements.mjs";
import { seedWorkspace } from "../src/domain.ts";
test("global pruning protects old stable, pinned and active builds across projects", () => {
  const old = [
    { id: "stable", projectId: "old", status: "verified", files: [{}] },
    { id: "pin", projectId: "old", pinned: true, status: "failed" },
    { id: "active", projectId: "old", status: "validating" },
  ];
  const rows = Array.from({ length: 45 }, (_, i) => ({
    id: "n" + i,
    projectId: "p" + i,
    status: "failed",
  }));
  const retained = retainedBuildIds([...rows, ...old]);
  for (const b of old) assert.equal(retained.has(b.id), true);
  assert.equal(retained.size, 33);
});
test("revalidating an old source never promotes its age or evicts a newer source baseline", () => {
  const older = {
    id: "older",
    projectId: "p",
    status: "verified",
    mode: "generate",
    files: [{}],
    startedAt: "2026-01-01T00:00:00.000Z",
  };
  const newer = {
    ...older,
    id: "newer",
    startedAt: "2026-02-01T00:00:00.000Z",
  };
  const recheck = {
    ...older,
    id: "recheck",
    mode: "validate",
    baseBuildId: older.id,
    startedAt: "2026-03-01T00:00:00.000Z",
  };
  const rows = [recheck, newer, older];
  assert.equal(buildSelection(rows).recommended.get("p").id, newer.id);
  const inherited = sourceOrigin(recheck, rows);
  assert.equal(inherited.startedAt, older.startedAt);
  const archived = { ...recheck, sourceOrigin: inherited };
  const failures = Array.from({ length: 6 }, (_, i) => ({
    id: "fail" + i,
    projectId: "p",
    status: "failed",
  }));
  assert.equal(
    retainedBuildIds([...failures, archived, newer]).has(newer.id),
    true,
  );
  // A pre-upgrade dangling chain cannot invent a fresh source creation date.
  assert.equal(
    buildSelection([recheck, newer]).recommended.get("p").id,
    newer.id,
  );
  const cycle = { ...recheck, baseBuildId: recheck.id };
  assert.equal(sourceOrigin(cycle, [cycle]).startedAt, null);
});
test("source sequences survive clock rollback; a matching historical baseline is additionally protected", () => {
  const state = seedWorkspace(),
    id = state.projects[0].id;
  const hash = requirementsHash(requirements(state, id));
  const current = {
    id: "current",
    projectId: id,
    status: "verified",
    files: [{}],
    requirementsVersion: 2,
    requirementsHash: hash,
    sourceOrigin: {
      id: "current",
      sequence: 1,
      startedAt: "2026-03-01T00:00:00Z",
    },
  };
  const newer = {
    ...current,
    id: "newer",
    requirementsHash: "different",
    sourceOrigin: {
      id: "newer",
      sequence: 2,
      startedAt: "2026-01-01T00:00:00Z",
    },
  };
  const chosen = buildSelection([newer, current], state);
  assert.equal(chosen.baselines.get(id).id, newer.id);
  assert.equal(chosen.recommended.get(id).id, current.id);
  assert.ok(chosen.protectedIds.has(current.id));
  assert.ok(chosen.protectedIds.has(newer.id));
});
test("semantic hashes normalize knowledge/dependency ordering and timestamps, not text; legacy stays strict", () => {
  const s = seedWorkspace(),
    id = s.projects[0].id;
  const input = requirements(s, id),
    v2 = requirementsHash(input),
    v1 = requirementsHash(input, 1);
  s.knowledge = s.knowledge
    .map((n) => ({ ...n, updatedAt: new Date().toISOString() }))
    .reverse();
  s.projects[0].color = "pink";
  s.tasks.reverse();
  assert.equal(requirementsHash(requirements(s, id)), v2);
  assert.notEqual(requirementsHash(requirements(s, id), 1), v1);
  assert.equal(requirementsHash(input, 1), hashInput(input));
  s.tasks.find((t) => t.projectId === id).description += " 新的业务要求";
  assert.notEqual(requirementsHash(requirements(s, id)), v2);
});
