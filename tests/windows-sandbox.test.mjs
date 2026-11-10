import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sandboxAvailable,
  validateProject,
} from "../server/project-sandbox.mjs";

// A runtime permission flag / JS network monkey patch is not an OS sandbox.
// Exercise this guard on Linux CI too: no subprocess must run on unsupported OSes.
for (const platform of ["win32", "darwin"]) {
  test(`${platform}: unavailable isolation never falls back to host execution`, async (t) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      ...descriptor,
      value: platform,
    });
    t.after(() => Object.defineProperty(process, "platform", descriptor));
    const available = await sandboxAvailable();
    assert.equal(available.available, false);
    const report = await validateProject([]);
    assert.equal(report.passed, false);
    assert.equal(report.unavailable, true);
    assert.deepEqual(report.checks, []);
  });
}
