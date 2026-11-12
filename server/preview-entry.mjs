// Trusted controller inside the OS sandbox. Only raster frames cross back to the host.
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { chromium } from "/toolchain/node_modules/playwright/index.mjs";

const base = "http://127.0.0.1:8080";
const maxFrameBytes = 2 * 1024 * 1024;
let application, browser, page, context;
let viewport = { width: 1280, height: 800 };
let processing = false;
let stopping = false;
let logs = "";
const append = (chunk) => {
  logs = (logs + chunk.toString()).slice(-5000);
};
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const runBuild = () =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/build.mjs"], {
      cwd: "/work",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error("预览构建失败：" + logs));
    });
  });
const stopApplication = async () => {
  if (
    !application ||
    application.exitCode !== null ||
    application.signalCode !== null
  )
    return;
  const child = application;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 1500);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
};
const startApplication = async () => {
  // The application cannot see the trusted browser/controller's processes,
  // pipe descriptors or browser profile. Only the private outer loopback is shared.
  application = spawn(
    "/usr/bin/bwrap",
    [
      "--unshare-user",
      "--unshare-pid",
      "--unshare-ipc",
      "--unshare-uts",
      "--unshare-cgroup",
      "--die-with-parent",
      "--new-session",
      "--cap-drop",
      "ALL",
      "--clearenv",
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind-try",
      "/lib64",
      "/lib64",
      "--symlink",
      "usr/bin",
      "/bin",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--dir",
      "/etc",
      "--ro-bind-try",
      "/etc/ld.so.cache",
      "/etc/ld.so.cache",
      "--ro-bind",
      "/work",
      "/work",
      "--ro-bind",
      "/toolchain",
      "/toolchain",
      "--ro-bind",
      "/runtime",
      "/runtime",
      "--bind",
      "/tmp/preview-data",
      "/data",
      "--setenv",
      "PATH",
      "/runtime:/usr/bin:/bin",
      "--setenv",
      "HOME",
      "/tmp",
      "--setenv",
      "TMPDIR",
      "/tmp",
      "--setenv",
      "PORT",
      "8080",
      "--setenv",
      "HOST",
      "127.0.0.1",
      "--setenv",
      "DATA_DIR",
      "/data",
      "--setenv",
      "NODE_OPTIONS",
      "--max-old-space-size=384",
      "--chdir",
      "/work",
      "/runtime/node",
      "server/start.mjs",
    ],
    {
      cwd: "/work",
      env: {
        ...process.env,
        PORT: "8080",
        HOST: "127.0.0.1",
        DATA_DIR: "/tmp/preview-data",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  application.stdout.on("data", append);
  application.stderr.on("data", append);
  let error;
  application.once("error", (e) => {
    error = e;
  });
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (error) throw error;
    if (application.exitCode !== null)
      throw new Error("预览服务提前退出：" + logs);
    try {
      const response = await fetch(base + "/healthz", {
        redirect: "error",
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("预览服务启动超时");
};
const openPage = async () => {
  if (context) await context.close();
  context = await browser.newContext({
    viewport,
    acceptDownloads: false,
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === base ? route.continue() : route.abort();
  });
  await context.routeWebSocket("**/*", (socket) => socket.close());
  page = await context.newPage();
  context.on("page", (other) => {
    if (other !== page) void other.close().catch(() => {});
  });
  page.on("dialog", (dialog) => void dialog.dismiss().catch(() => {}));
  page.on("download", (download) => void download.cancel().catch(() => {}));
  page.setDefaultTimeout(4000);
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 12000 });
};
const frame = async () => {
  // Never screenshot host content; navigation is restricted even if the app tries to leave its origin.
  if (new URL(page.url()).origin !== base)
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 10000 });
  const bytes = await page.screenshot({
    type: "png",
    timeout: 5000,
    animations: "disabled",
  });
  if (bytes.length > maxFrameBytes) throw new Error("预览图像超过容量限制");
  return { png: bytes.toString("base64"), ...viewport };
};
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await browser?.close().catch(() => {});
  await stopApplication();
  process.exit(0);
};
const keys = new Set([
  "Tab",
  "Shift+Tab",
  "Enter",
  "Backspace",
  "Delete",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "Escape",
  "Control+A",
]);
const action = async (request) => {
  if (!request || !Number.isSafeInteger(request.id) || request.id < 1)
    throw new Error("无效请求");
  const a = request.action;
  if (!a || typeof a.type !== "string") throw new Error("无效操作");
  if (a.type === "click") {
    if (
      !Number.isFinite(a.x) ||
      !Number.isFinite(a.y) ||
      a.x < 0 ||
      a.y < 0 ||
      a.x >= viewport.width ||
      a.y >= viewport.height
    )
      throw new Error("点击超出预览范围");
    await page.mouse.click(a.x, a.y);
  } else if (a.type === "text") {
    if (typeof a.value !== "string" || a.value.length > 2000)
      throw new Error("输入过长");
    await page.keyboard.insertText(a.value);
  } else if (a.type === "key") {
    if (!keys.has(a.key)) throw new Error("不支持此按键");
    await page.keyboard.press(a.key);
  } else if (a.type === "scroll") {
    if (!Number.isInteger(a.deltaY) || Math.abs(a.deltaY) > 800)
      throw new Error("无效滚动");
    await page.mouse.wheel(0, a.deltaY);
  } else if (a.type === "viewport") {
    if (!["desktop", "mobile"].includes(a.mode)) throw new Error("无效视口");
    viewport =
      a.mode === "mobile"
        ? { width: 390, height: 844 }
        : { width: 1280, height: 800 };
    await page.setViewportSize(viewport);
  } else if (a.type === "reload") {
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 10000 });
  } else if (a.type === "restart") {
    await context.close();
    context = null;
    await stopApplication();
    await startApplication();
    await openPage();
  } else if (a.type !== "frame") throw new Error("不支持此操作");
  if (a.type !== "frame")
    await new Promise((resolve) => setTimeout(resolve, 150));
  return frame();
};
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
try {
  await fs.mkdir("/tmp/preview-data", { recursive: true });
  await runBuild();
  await startApplication();
  browser = await chromium.launch({
    headless: true,
    args: ["--disable-gpu", "--no-sandbox"],
  });
  await openPage();
  send({ ready: true, ...(await frame()) });
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("close", () => void stop());
  input.on("line", (line) => {
    if (processing || line.length > 12000) return void stop();
    processing = true;
    void (async () => {
      let request;
      try {
        request = JSON.parse(line);
        send({ id: request.id, ...(await action(request)) });
      } catch (error) {
        send({ id: request?.id, error: String(error.message).slice(0, 2000) });
      } finally {
        processing = false;
      }
    })();
  });
} catch (error) {
  send({ error: String(error.message).slice(0, 2000) });
  await stop();
}
