// Fixed harness: model supplies declarative cases, never verification commands.
import fs from "node:fs/promises";
import { writeSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import net from "node:net";
import assert from "node:assert/strict";
const root = process.cwd();
const report = {
  passed: false,
  checks: [],
  logs: "",
  screenshot: null,
  scope:
    "构建、启动、声明的接口、重启持久化与浏览器冒烟；不等于完整业务验收或部署验证",
};
const append = (s) => {
  report.logs = (report.logs + s).slice(-24000);
};
let child, browser, data;
const check = async (name, fn) => {
  const started = Date.now();
  try {
    await fn();
    report.checks.push({
      name,
      passed: true,
      detail: "通过",
      durationMs: Date.now() - started,
    });
  } catch (e) {
    report.checks.push({
      name,
      passed: false,
      durationMs: Date.now() - started,
      detail: String(e.message).slice(0, 3000),
    });
    throw e;
  }
};
const run = async (args) =>
  new Promise((resolve, reject) => {
    const c = spawn(process.execPath, args, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    c.stdout.on("data", (x) => append(x.toString()));
    c.stderr.on("data", (x) => append(x.toString()));
    c.on("error", reject);
    c.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              "构建命令退出码 " + code + "\n" + report.logs.slice(-6000),
            ),
          ),
    );
  });
const stopServer = async () => {
  if (!child) return;
  child.kill("SIGTERM");
  await new Promise((r) => {
    if (child.exitCode !== null) return r();
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      r();
    }, 1500);
    child.once("exit", () => {
      clearTimeout(timer);
      r();
    });
  });
};
try {
  await check("生产构建", () => run(["scripts/build.mjs"]));
  const tests = JSON.parse(await fs.readFile("tests/acceptance.json", "utf8"));
  data = await fs.mkdtemp(path.join(os.tmpdir(), "ark-app-test-"));
  const reservation = net.createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const base = `http://127.0.0.1:${port}`;
  const startServer = async () => {
    const isolate = process.env.ARK_ISOLATE_SERVER === "1";
    const reads = isolate
      ? [
          root,
          process.env.ARK_NODE_DIR,
          data,
          ...(process.env.ARK_EXTRA_READS || "").split("|"),
          process.env.ARK_NET_GUARD_PATH,
        ].filter(Boolean)
      : [];
    child = spawn(
      process.execPath,
      isolate
        ? [
            "--permission",
            ...(process.env.ARK_NET_GUARD
              ? ["--import", process.env.ARK_NET_GUARD]
              : []),
            ...reads.flatMap((entry) => [`--allow-fs-read=${entry}`]),
            `--allow-fs-write=${data}`,
            "server/start.mjs",
          ]
        : ["server/start.mjs"],
      {
        cwd: root,
        env: isolate
          ? {
              PATH: process.env.PATH || "",
              SystemRoot: process.env.SystemRoot || "",
              PATHEXT: process.env.PATHEXT || "",
              PORT: String(port),
              HOST: "127.0.0.1",
              DATA_DIR: data,
            }
          : {
              ...process.env,
              PORT: String(port),
              HOST: "127.0.0.1",
              DATA_DIR: data,
            },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (x) => append(x.toString()));
    child.stderr.on("data", (x) => append(x.toString()));
    let spawnError;
    child.on("error", (e) => {
      spawnError = e;
    });

    const end = Date.now() + 12000;
    let ready = false;
    while (Date.now() < end) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null)
        throw new Error("服务提前退出\n" + report.logs);
      try {
        const r = await fetch(base + "/healthz", {
          signal: AbortSignal.timeout(500),
          redirect: "error",
        });
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, "服务启动超时");
    const html = await (await fetch(base)).text();
    assert.ok(html.includes("/assets/app.js"), "缺少实际前端入口");
    assert.equal((await fetch(base + "/assets/app.js")).status, 200);
  };
  await check("前后端服务启动", startServer);
  await check("静态资源与请求错误状态", async () => {
    assert.equal(
      (await fetch(base + "/assets/missing.js")).status,
      404,
      "缺失静态资源不能返回成功 HTML",
    );
    const invalid = await fetch(base + "/api/__ark_input_check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{broken",
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(invalid.status, 400, "无效 JSON 应返回 400");
  });
  const apiTest = async (t) => {
    const r = await fetch(base + t.path, {
      method: t.method,
      headers: { "content-type": "application/json" },
      body: t.body === undefined ? undefined : JSON.stringify(t.body),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    assert.equal(r.status, t.status, "接口状态码不匹配");
    const text = await r.text();
    assert.ok(
      text.includes(t.contains),
      "接口缺少预期内容：" + t.contains + "\n实际：" + text.slice(0, 2000),
    );
  };
  for (const t of tests.api) await check("接口：" + t.name, () => apiTest(t));
  await check("SQLite 数据与重启后读回", async () => {
    await stopServer();
    const entries = await fs.readdir(data, { recursive: true });
    let sqlite = false;
    for (const name of entries) {
      const file = path.join(data, name);
      if (!(await fs.stat(file)).isFile()) continue;
      const handle = await fs.open(file);
      try {
        const b = Buffer.alloc(16);
        await handle.read(b, 0, 16, 0);
        if (b.toString() === "SQLite format 3\0") sqlite = true;
      } finally {
        await handle.close();
      }
    }
    assert.ok(sqlite, "未发现 DATA_DIR 中的持久化 SQLite 数据库");
    await startServer();
    for (const t of tests.api.filter((t) => t.method === "GET"))
      await apiTest(t);
  });
  if (!process.argv.includes("--api-only")) {
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-gpu", "--no-sandbox"],
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      return u.origin === base || ["data:", "blob:"].includes(u.protocol)
        ? route.continue()
        : route.abort();
    });
    await check("浏览器启动与前后端交互", async () => {
      await page.goto(base, { waitUntil: "networkidle", timeout: 15000 });
      for (const step of tests.browser) {
        if (step.action === "fill")
          await page.locator(step.selector).fill(step.value, { timeout: 5000 });
        if (step.action === "click")
          await page.locator(step.selector).click({ timeout: 5000 });
        if (step.action === "text")
          await page
            .getByText(step.value, { exact: false })
            .first()
            .waitFor({ timeout: 5000 });
      }
      assert.equal(errors.length, 0, "浏览器错误：" + errors.join("\n"));
      assert.ok(
        (await page.locator("#root").innerText()).trim().length > 0,
        "页面为空",
      );
    });
    await check("手机视口基本布局", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload({ waitUntil: "networkidle", timeout: 15000 });
      const lastAssertion = tests.browser.findLast(
        (step) => step.action === "text",
      );
      if (lastAssertion)
        await page
          .getByText(lastAssertion.value, { exact: false })
          .first()
          .waitFor({ timeout: 5000 });
      assert.equal(errors.length, 0, "刷新后浏览器错误：" + errors.join("\n"));
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "手机页面发生横向溢出",
      );
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    report.screenshot = (await page.screenshot({ type: "png" })).toString(
      "base64",
    );
  }
  report.passed = true;
} catch (e) {
  append("\n" + String(e.stack || e));
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer();
  if (data) await fs.rm(data, { recursive: true, force: true }).catch(() => {});
  if (process.env.ARK_REPORT_FD === "3") {
    const bytes = Buffer.from(JSON.stringify(report));
    let offset = 0;
    while (offset < bytes.length)
      offset += writeSync(3, bytes, offset, bytes.length - offset);
  } else if (process.env.ARK_REPORT_MARKER === "1")
    console.log("ARK_VERIFICATION_REPORT=" + JSON.stringify(report));
  else
    console.log(JSON.stringify({ ...report, screenshot: undefined }, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
