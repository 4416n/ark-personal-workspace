import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { materialize } from "./project-bundle.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const childEnv = {
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
export async function toolchainMounts() {
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
export function bubbleArgs(
  input,
  browser,
  mounts,
  entry = "sandbox-entry.mjs",
) {
  if (!["sandbox-entry.mjs", "preview-entry.mjs"].includes(entry))
    throw new Error("Unknown trusted sandbox entry");
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
    path.join(root, "server", entry),
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
// Only trusted environment probes run here. Generated files are never executed by diagnostics.
// Dependencies are injectable for deterministic checks on hosts without Linux isolation.
export async function diagnoseSandbox({
  platform = process.platform,
  nodeVersion = process.versions.node,
  dependencies = toolchainMounts,
  inspectFile = (file) => fs.access(file),
  run = command,
  chromiumPath = async () =>
    (await import("@playwright/test")).chromium.executablePath(),
} = {}) {
  const checks = [];
  const add = (id, label, status, detail, action) =>
    checks.push({ id, label, status, detail, ...(action ? { action } : {}) });
  const linux = platform === "linux";
  add(
    "platform",
    "操作系统",
    linux ? "passed" : "unsupported",
    linux
      ? "Linux 支持隔离验证。"
      : `${platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : platform} 暂不支持自动隔离验证。`,
    linux
      ? undefined
      : "在支持 systemd 用户服务的 Linux 电脑上运行工作台。本机仍可生成和导出未验证源码。",
  );
  const currentNode = Number(nodeVersion.split(".")[0]) >= 24;
  add(
    "node",
    "Node.js 版本",
    currentNode ? "passed" : "failed",
    `当前 ${nodeVersion}；工程验证需要 Node.js 24+。`,
    currentNode ? undefined : "升级到 Node.js 24 或更新版本后重新启动工作台。",
  );
  if (!linux) {
    for (const [id, label] of [
      ["tools", "隔离工具"],
      ["systemd", "systemd 用户服务"],
      ["dependencies", "工程验证依赖"],
      ["chromium", "Chromium 浏览器"],
      ["isolation", "隔离与资源限制"],
    ])
      add(
        id,
        label,
        "unsupported",
        "当前操作系统不支持此验证环境，未执行 Linux 检查。",
      );
  } else {
    let toolsReady = true;
    try {
      await Promise.all(
        ["/usr/bin/bwrap", "/usr/bin/systemd-run", "/usr/bin/systemctl"].map(
          inspectFile,
        ),
      );
      add(
        "tools",
        "隔离工具",
        "passed",
        "已找到 bubblewrap、systemd-run 和 systemctl。",
      );
    } catch {
      toolsReady = false;
      add(
        "tools",
        "隔离工具",
        "failed",
        "缺少 bubblewrap 或 systemd 工具。",
        "安装 bubblewrap 与 systemd 用户服务组件；Debian / Ubuntu 可安装 bubblewrap、dbus-user-session。",
      );
    }
    let serviceReady = false;
    if (toolsReady) {
      try {
        const service = await run(
          "/usr/bin/systemctl",
          ["--user", "show", "--property=Version", "--value"],
          { timeout: 5000, limit: 16384 },
        );
        serviceReady = service.code === 0 && !service.over;
      } catch {
        // A missing user bus is a failed prerequisite, not permission to run on the host.
      }
      add(
        "systemd",
        "systemd 用户服务",
        serviceReady ? "passed" : "failed",
        serviceReady
          ? "当前用户可以访问 systemd 服务管理器。"
          : "当前进程无法连接 systemd 用户服务。",
        serviceReady
          ? undefined
          : "在已登录的 Linux 用户会话中运行工作台，并确认 systemctl --user status 可用。",
      );
    } else {
      add(
        "systemd",
        "systemd 用户服务",
        "unsupported",
        "先安装隔离工具，再检查用户服务。",
      );
    }
    try {
      await dependencies();
      add(
        "dependencies",
        "工程验证依赖",
        "passed",
        "本机依赖与交付工程锁文件一致。",
      );
    } catch (e) {
      add(
        "dependencies",
        "工程验证依赖",
        "failed",
        e.message,
        "在工作台目录运行 npm ci 后重新检查。",
      );
    }
    try {
      await inspectFile(await chromiumPath());
      add(
        "chromium",
        "Chromium 浏览器",
        "passed",
        "已找到 Playwright 使用的 Chromium。",
      );
    } catch {
      add(
        "chromium",
        "Chromium 浏览器",
        "failed",
        "未找到 Playwright Chromium 浏览器。",
        "在工作台目录运行 npx playwright install --with-deps chromium 后重新检查。",
      );
    }
    if (serviceReady) {
      let isolated = false;
      try {
        const probe = await run(
          "/usr/bin/systemd-run",
          [
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
          ],
          { timeout: 10000, limit: 16384 },
        );
        isolated = probe.code === 0 && !probe.over;
      } catch {
        // Keep the environment unavailable if namespaces or resource restrictions fail.
      }
      add(
        "isolation",
        "隔离与资源限制",
        isolated ? "passed" : "failed",
        isolated
          ? "实际隔离探针通过；工程执行受网络、文件系统、进程和资源限制。"
          : "工具已安装，但隔离探针或用户资源限制未通过。",
        isolated
          ? undefined
          : "检查 Linux 的用户命名空间和 systemd 资源限制配置；环境修复前仅导出源码。",
      );
    } else {
      add(
        "isolation",
        "隔离与资源限制",
        "unsupported",
        "用户服务可用后才能安全执行隔离探针。",
      );
    }
  }
  const available = checks.every((check) => check.status === "passed");
  return {
    available,
    reason: available
      ? "网络/文件系统/PID 隔离，1GB 内存、192 进程、120秒时限，临时数据库"
      : !linux
        ? "自动验证目前需要 Linux、bubblewrap、systemd 用户服务及 Playwright Chromium；本机可交付未验证源码，不会降级为宿主机直接运行代码"
        : `隔离验证不可用：${checks
            .filter((check) => check.status === "failed")
            .map((check) => check.label)
            .join("、")}。可交付未验证源码；不会执行未隔离代码。`,
    platform,
    nodeVersion,
    checkedAt: new Date().toISOString(),
    checks,
  };
}
export async function sandboxAvailable() {
  return diagnoseSandbox();
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
