// Deliberately opt-in. Runs generated fixture code ONLY through project-sandbox.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import {
  validateProject,
  sandboxAvailable,
} from "../server/project-sandbox.mjs";
import { assembleBundle } from "../server/project-bundle.mjs";
import { fullstackFixture } from "./fixtures/fullstack.mjs";
test("actual fullstack builds, writes SQLite, survives restart and passes browser interactions in isolated namespace", async () => {
  assert.equal(
    (await sandboxAvailable()).available,
    true,
    "This opt-in suite requires a real working sandbox",
  );
  const report = await validateProject(
    await assembleBundle(fullstackFixture()),
  );
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.ok(report.checks.some((c) => c.name.includes("重启") && c.passed));
  assert.ok(report.screenshot);
  await fs.mkdir("artifacts", { recursive: true });
  await fs.writeFile(
    "artifacts/v32-built-preview.png",
    Buffer.from(report.screenshot, "base64"),
  );
  await fs.writeFile(
    "artifacts/v32-real-verification.json",
    JSON.stringify({ ...report, screenshot: undefined }, null, 2),
  );
});
test("actual sandbox blocks host files/environment/network and detects a broken build", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-host-secret-"));
  await fs.writeFile(path.join(dir, "secret"), "never expose");
  let contacted = false;
  const server = http
    .createServer((_req, res) => {
      contacted = true;
      res.end("host");
    })
    .listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const fixture = fullstackFixture();
  fixture.files.find((f) => f.path === "server/app.mjs").content =
    `import fs from 'node:fs';import assert from 'node:assert/strict';assert.equal(fs.existsSync(${JSON.stringify(dir + "/secret")}),false);assert.equal(fs.existsSync(${JSON.stringify(path.resolve(".local"))}),false);await assert.rejects(fetch('http://127.0.0.1:${server.address().port}',{signal:AbortSignal.timeout(500)}));\n` +
    fixture.files.find((f) => f.path === "server/app.mjs").content;
  const isolated = await validateProject(await assembleBundle(fixture));
  assert.equal(isolated.passed, true, JSON.stringify(isolated));
  assert.equal(contacted, false);
  const extra = fullstackFixture();
  extra.files[0].content =
    "import {z} from 'zod'; console.log(z);" + extra.files[0].content;
  const undeclared = await validateProject(await assembleBundle(extra));
  assert.equal(
    undeclared.passed,
    false,
    "workbench-only dependency must not pass delivered app verification",
  );
  assert.match(undeclared.logs, /zod/);
  fixture.files[0].content = "this is not valid JSX !!";
  const broken = await validateProject(await assembleBundle(fixture));
  assert.equal(broken.passed, false);
  assert.equal(broken.checks[0].name, "生产构建");
  assert.equal(broken.checks[0].passed, false);
});
test("actual cancellation kills the sandbox service tree", async () => {
  const fixture = fullstackFixture();
  fixture.files.find((f) => f.path === "server/app.mjs").content =
    "while(true){}";
  const c = new AbortController();
  const p = validateProject(await assembleBundle(fixture), {
    signal: c.signal,
  });
  const timer = setTimeout(() => c.abort(), 2000);
  try {
    await assert.rejects(p, /abort/i);
  } finally {
    clearTimeout(timer);
  }
  const units = execFileSync(
    "/usr/bin/systemctl",
    [
      "--user",
      "list-units",
      "--state=running",
      "--no-legend",
      "ark-verify-*.service",
    ],
    {
      encoding: "utf8",
      env: {
        PATH: "/usr/bin:/bin",
        HOME: os.homedir(),
        XDG_RUNTIME_DIR:
          process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`,
        DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || "",
      },
    },
  );
  assert.equal(units.trim(), "");
});

test("sandbox application cannot rewrite source, tests or trusted scripts", async () => {
  const fixture = fullstackFixture();
  const app = fixture.files.find((f) => f.path === "server/app.mjs");
  app.content =
    `import fs from 'node:fs';import assert from 'node:assert/strict';for(const name of ['scripts/verify.mjs','tests/acceptance.json','src/main.jsx','server/start.mjs']){assert.throws(()=>fs.writeFileSync(name,'tampered'),/read-only|EROFS|EACCES/);assert.throws(()=>fs.unlinkSync(name),/read-only|EROFS|EACCES/);}assert.throws(()=>fs.renameSync('src','src-hidden'),/read-only|EROFS|EACCES/);\n` +
    app.content;
  const report = await validateProject(await assembleBundle(fixture));
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.ok(
    report.checks.some((c) => c.name === "静态资源与请求错误状态" && c.passed),
  );
  assert.ok(report.checks.every((c) => typeof c.durationMs === "number"));
});
