import { test } from "node:test";
import assert from "node:assert/strict";
import { retainedBuildIds } from "../server/build-policy.mjs";
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
