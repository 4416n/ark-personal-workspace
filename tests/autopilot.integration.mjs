import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dockerRuntime } from "../server/docker-runtime.mjs";
import { releaseManager } from "../server/release-manager.mjs";
import { assembleBundle, sourceHash } from "../server/project-bundle.mjs";
import { fullstackFixture } from "./fixtures/fullstack.mjs";
import { removeTestDirectory } from "./helpers/filesystem.mjs";

test("real Docker verification, production rollout, copied SQLite and automatic health rollback", { timeout: 900000 }, async (t) => {
  const runtime = dockerRuntime();
  const capability = await runtime.capability();
  assert.equal(capability.available, true, capability.reason);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-autopilot-real-"));
  const manager = releaseManager({ directory, runtime, firstPort: 18800, monitorMs: 600000 });
  const resources = [];
  const verifiedImages = [];
  t.after(async () => {
    manager.close();
    for (const release of resources) {
      await runtime.removeContainer(release.container);
      await runtime.command(["volume", "rm", release.volume]).catch(() => {});
      await runtime.command(["network", "rm", release.network]).catch(() => {});
      await runtime.command(["image", "rm", release.image]).catch(() => {});
    }
    for (const image of verifiedImages) await runtime.command(["image", "rm", "--force", image]).catch(() => {});
    await removeTestDirectory(directory);
  });
  const files = await assembleBundle(fullstackFixture());
  const validated = await runtime.validate(files);
  assert.equal(validated.passed, true, validated.logs);
  verifiedImages.push(validated.imageId);
  assert.equal(validated.coverage.browser, true);
  const build = { id: randomUUID(), files, sourceHash: sourceHash(files), validation: { ...validated, sourceHash: sourceHash(files) } };
  const first = await manager.deploy("notes", build);
  resources.push(first.current);
  const marker = "production-" + randomUUID();
  assert.equal((await fetch(first.url + "/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: marker }) })).status, 201);
  const nextFiles = structuredClone(files);
  nextFiles.find((file) => file.path === "README.md").content += "\nsecond-version";
  const secondReport = await runtime.validate(nextFiles);
  assert.equal(secondReport.passed, true, secondReport.logs);
  verifiedImages.push(secondReport.imageId);
  const second = await manager.deploy("notes", { ...build, id: randomUUID(), files: nextFiles, sourceHash: sourceHash(nextFiles), validation: { ...secondReport, sourceHash: sourceHash(nextFiles) } });
  resources.push(second.current);
  assert.ok((await (await fetch(second.url + "/api/notes")).text()).includes(marker));
  await runtime.command(["stop", second.current.container]);
  await manager.monitor(); await manager.monitor(); await manager.monitor();
  const restored = manager.list()[0];
  assert.equal(restored.status, "rolled-back");
  assert.equal(restored.current.id, first.current.id);
  assert.ok((await (await fetch(first.url + "/api/notes")).text()).includes(marker));
});
