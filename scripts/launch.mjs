import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { projectRoot, inspectWorkspace, supportedNode, portAvailable, launchOptions, findNpmCli } from "./workspace-setup.mjs";

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: projectRoot, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`命令未完成（${signal || code}）：${args.slice(1).join(" ")}`)));
  });
}
function openBrowser(url) {
  const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", windowsHide: true, detached: process.platform !== "win32" });
  child.once("error", () => console.log(`请在浏览器打开 ${url}`));
  child.unref();
}
export async function launch(args = []) {
  const options = launchOptions(args);
  if (options.help) {
    console.log("方舟启动器：node scripts/launch.mjs [--lan] [--no-open] [--check]\n默认仅本机；--lan 启用可信局域网手机连接；--check 只运行自检。PORT 可指定端口。");
    return;
  }
  if (options.check) {
    const { doctor } = await import("./doctor.mjs");
    process.exitCode = await doctor(args.filter((arg) => arg !== "--check")) ? 0 : 1;
    return;
  }
  if (!supportedNode(process.versions.node)) throw new Error(`当前 Node.js ${process.versions.node} 太旧，请安装 Node.js 22.18+，建议 24 LTS。`);
  const port = await portAvailable(options.port, options.lan ? "0.0.0.0" : "127.0.0.1");
  if (!port.available) throw new Error(`端口 ${options.port} 已被占用或无法使用（${port.reason}）。如方舟已运行，请打开 http://127.0.0.1:${options.port}；否则关闭占用程序或设置 PORT。`);
  let state = await inspectWorkspace();
  const npm = await findNpmCli();
  console.log(`\n方舟 v${state.version} · ${projectRoot}`);
  if (state.installNeeded) {
    console.log("[1/3] 首次安装或依赖发生变化，正在按锁文件安装（npm ci）…");
    await runNode([npm, "ci"]);
    state = await inspectWorkspace();
    state.buildNeeded = true;
  } else console.log("[1/3] 依赖已就绪，无需重复安装。");
  if (state.buildNeeded) {
    console.log("[2/3] 正在构建工作台页面…");
    await runNode([npm, "run", "build"]);
  } else console.log("[2/3] 页面已就绪，无需重复构建。");
  await fs.mkdir(path.dirname(state.markerPath), { recursive: true });
  await fs.writeFile(state.markerPath, JSON.stringify({ lockHash: state.lockHash }), "utf8");
  const url = `http://127.0.0.1:${options.port}`;
  console.log(`[3/3] 启动${options.lan ? "可信局域网工作台；手机请进入设置配对" : "本机工作台"}：${url}`);
  console.log("保持此窗口开启；关闭窗口或按 Ctrl+C 将停止服务。模型配置在工作台设置中完成。");
  const server = spawn(process.execPath, ["server/index.mjs", "--production", ...(options.lan ? ["--lan"] : [])], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(options.port) },
    stdio: ["inherit", "pipe", "inherit"],
    windowsHide: true,
  });
  let opened = false;
  server.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    if (!opened && options.open && chunk.toString().includes("方舟工作台服务已启动")) { opened = true; openBrowser(url); }
  });
  const stop = () => server.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", (code) => { process.exitCode = code || 0; resolve(); });
  });
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  launch(process.argv.slice(2)).catch((error) => { console.error(`\n启动未完成：${error.message}\n可运行 node scripts/doctor.mjs 查看自检结果。`); process.exitCode = 1; });
