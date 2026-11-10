import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { materialize } from "./project-bundle.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const childEnv = {
  PATH: "/usr/bin:/bin",
  HOME: os.homedir(),
  XDG_RUNTIME_DIR:
    process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.()}`,
  DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || "",
};
const command = (
  cmd,
  args,
  { signal, timeout = 10000, limit = 2_500_000, fd = false } = {},
) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: childEnv,
      stdio: fd
        ? ["ignore", "pipe", "pipe", "pipe"]
        : ["ignore", "pipe", "pipe"],
    });
    let out = "",
      log = "",
      report = "",
      bytes = 0,
      over = false;
    const stop = () => child.kill("SIGKILL");
    const timer = setTimeout(stop, timeout);
    const capture = (kind, b) => {
      bytes += b.length;
      if (bytes > limit) {
        over = true;
        stop();
        return;
      }
      if (kind === "out") out += b;
      else if (kind === "report") report += b;
      else log += b;
    };
    child.stdout.on("data", (b) => capture("out", b));
    child.stderr.on("data", (b) => capture("log", b));
    if (fd) child.stdio[3].on("data", (b) => capture("report", b));
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    child.once("error", (e) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      reject(e);
    });
    child.once("close", (code, sig) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      resolve({ code, out, log, report, over, signal: sig });
    });
  });
async function toolchainMounts() {
  const lock = JSON.parse(
    await fs.readFile(
      path.join(root, "server/scaffold/package-lock.json"),
      "utf8",
    ),
  );
  const mounts = [];
  for (const [name, spec] of Object.entries(lock.packages)) {
    if (!name) continue;
    let installed;
    try {
      installed = JSON.parse(
        await fs.readFile(path.join(root, name, "package.json"), "utf8"),
      );
    } catch (e) {
      if (spec.optional && e.code === "ENOENT") continue;
      throw new Error("验证依赖缺失，请运行 npm ci：" + name);
    }
    if (installed.version !== spec.version)
      throw new Error("验证依赖与交付锁文件不一致，请运行 npm ci：" + name);
    mounts.push("--ro-bind", path.join(root, name), "/toolchain/" + name);
  }
  return mounts;
}
function bubbleArgs(input, browser, mounts) {
  return [
    "--unshare-all",
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
    "--size",
    "536870912",
    "--tmpfs",
    "/tmp",
    "--ro-bind",
    input,
    "/work",
    "--size",
    "536870912",
    "--tmpfs",
    "/work/dist",
    "--dir",
    "/etc",
    "--ro-bind-try",
    "/etc/fonts",
    "/etc/fonts",
    "--ro-bind-try",
    "/etc/ld.so.cache",
    "/etc/ld.so.cache",
    ...mounts,
    "--ro-bind",
    input,
    "/input",
    "--ro-bind",
    browser,
    "/browsers",
    "--ro-bind",
    path.join(root, "server/sandbox-entry.mjs"),
    "/entry.mjs",
    "--ro-bind",
    process.execPath,
    "/runtime/node",
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
    "PLAYWRIGHT_BROWSERS_PATH",
    "/browsers",
    "--setenv",
    "ARK_REPORT_FD",
    "3",
    "--setenv",
    "NODE_OPTIONS",
    "--max-old-space-size=384",
    "--chdir",
    "/work",
    "/runtime/node",
    "/entry.mjs",
  ];
}
export async function sandboxAvailable() {
  if (process.platform !== "linux")
    return {
      available: false,
      reason:
        "自动验证目前需要 Linux、bubblewrap、systemd 用户服务及 Playwright Chromium；不会降级为宿主机直接运行代码",
    };
  try {
    if (Number(process.versions.node.split(".")[0]) < 24)
      throw new Error("工程运行需要 Node.js 24+");
    await toolchainMounts();
    const probe = await command("/usr/bin/systemd-run", [
      "--user",
      "--quiet",
      "--wait",
      "--pipe",
      "--collect",
      "--property=MemoryMax=1024M",
      "--property=TasksMax=192",
      "--property=RuntimeMaxSec=8",
      "/usr/bin/bwrap",
      "--unshare-all",
      "--die-with-parent",
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind-try",
      "/lib64",
      "/lib64",
      "/usr/bin/true",
    ]);
    if (probe.code !== 0) throw new Error("Linux 隔离或用户资源限制不可用");
    const { chromium } = await import("@playwright/test");
    const browser = chromium.executablePath();
    await fs.access(browser);
    return {
      available: true,
      reason:
        "网络/文件系统/PID 隔离，1GB 内存、192 进程、120秒时限，临时数据库",
    };
  } catch (e) {
    return {
      available: false,
      reason:
        "隔离验证不可用：" +
        e.message +
        "。请安装 bubblewrap、启用 systemd 用户服务并运行 npx playwright install chromium；不会执行未隔离代码",
    };
  }
}
export async function validateProject(files, { signal } = {}) {
  signal?.throwIfAborted();
  const available = await sandboxAvailable();
  signal?.throwIfAborted();
  if (!available.available)
    return {
      passed: false,
      unavailable: true,
      checks: [],
      logs: available.reason,
    };
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "ark-engineering-"),
  );
  const unit = "ark-verify-" + randomUUID();
  try {
    await materialize(directory, files);
    // The generated backend may write only to temporary data, never source/tests/harness.
    await fs.mkdir(path.join(directory, "dist"));
    await fs.symlink(
      "/toolchain/node_modules",
      path.join(directory, "node_modules"),
    );
    const { chromium } = await import("@playwright/test");
    const browserRoot = path.dirname(
      path.dirname(path.dirname(chromium.executablePath())),
    );
    const mounts = await toolchainMounts();
    // systemd owns the entire process tree. Killing the client alone must not leave code running.
    const stop = () =>
      void command("/usr/bin/systemctl", [
        "--user",
        "kill",
        "--kill-whom=all",
        "--signal=KILL",
        unit + ".service",
      ]).catch(() => {});
    signal?.addEventListener("abort", stop, { once: true });
    let r;
    try {
      r = await command(
        "/usr/bin/systemd-run",
        [
          "--user",
          "--quiet",
          "--wait",
          "--pipe",
          "--collect",
          "--unit=" + unit,
          "--property=MemoryMax=1024M",
          "--property=MemorySwapMax=0",
          "--property=TasksMax=192",
          "--property=CPUQuota=100%",
          "--property=RuntimeMaxSec=120",
          "--property=LimitCORE=0",
          "--property=LimitFSIZE=67108864",
          "/usr/bin/bwrap",
          ...bubbleArgs(directory, browserRoot, mounts),
        ],
        { signal, timeout: 125000, fd: true },
      );
    } finally {
      signal?.removeEventListener("abort", stop);
      await command("/usr/bin/systemctl", [
        "--user",
        "stop",
        unit + ".service",
      ]).catch(() => {});
    }
    signal?.throwIfAborted();
    // --pipe only forwards stdio; report travels on stdout from the trusted entry parent.
    const marker = "ARK_VERIFICATION_REPORT=";
    const line = r.out.split("\n").findLast((x) => x.startsWith(marker));
    if (!line)
      return {
        passed: false,
        checks: [],
        logs: (
          "隔离执行失败或达到时间/内存/日志限制\n" +
          r.log +
          "\n" +
          r.out
        ).slice(-24000),
      };
    const report = JSON.parse(line.slice(marker.length));
    report.passed = report.passed === true && r.code === 0 && !r.over;
    return report;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
