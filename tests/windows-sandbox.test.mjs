import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { sandboxAvailable, validateProject } from "../server/project-sandbox.mjs";
import { assembleBundle } from "../server/project-bundle.mjs";
import { fullstackFixture } from "./fixtures/fullstack.mjs";

test("Windows 权限沙箱可以实际验收，并且不读取宿主文件", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows sandbox probe");
    return;
  }
  const available = await sandboxAvailable();
  assert.equal(available.available, true, available.reason);
  const report = await validateProject(await assembleBundle(fullstackFixture()));
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.equal(report.sandbox, "windows-permission");
  assert.ok(report.checks.some((check) => check.name.includes("重启") && check.passed));
  assert.ok(!report.checks.some((check) => check.name.includes("浏览器")));
});

test("Windows 沙箱中的生成服务读不到宿主文件、环境变量和网络", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows sandbox probe");
    return;
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-host-secret-"));
  const secret = path.join(directory, "secret");
  await fs.writeFile(secret, "never expose");
  let contacted = false;
  const server = http
    .createServer((_req, res) => {
      contacted = true;
      res.end("host");
    })
    .listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const fixture = fullstackFixture();
  const app = fixture.files.find((file) => file.path === "server/app.mjs");
  const port = server.address().port;
  app.content =
    `import fs from 'node:fs'; import assert from 'node:assert/strict';` +
    `assert.equal(process.env.ARK_SENTINEL, undefined);` +
    `assert.throws(() => fs.readFileSync(${JSON.stringify(secret)}));` +
    `await assert.rejects(fetch('http://127.0.0.1:${port}', { signal: AbortSignal.timeout(500) }));\n` +
    app.content;
  process.env.ARK_SENTINEL = "host-secret";
  t.after(() => {
    delete process.env.ARK_SENTINEL;
  });
  const report = await validateProject(await assembleBundle(fixture));
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.equal(contacted, false);
});
