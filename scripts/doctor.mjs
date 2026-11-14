import { pathToFileURL } from "node:url";
import path from "node:path";
import { projectRoot, inspectWorkspace, supportedNode, portAvailable, launchOptions, findNpmCli } from "./workspace-setup.mjs";

export async function doctor(args = []) {
  const options = launchOptions(args);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  add("Node.js", supportedNode(process.versions.node), `${process.versions.node}（基础工作台需 22.18+；工程验证建议 24+）`);
  let state;
  try {
    state = await inspectWorkspace();
    add("项目目录", true, `${projectRoot} · v${state.version}`);
    add("依赖", !state.installNeeded, state.installNeeded ? `需安装或更新：${state.missing.join("、") || "锁文件已变化"}；启动器会运行 npm ci` : "与锁文件一致");
    add("页面构建", !state.buildNeeded, state.buildNeeded ? "未构建或源码已更新；启动器会运行 npm run build" : "dist 已就绪");
  } catch (error) { add("项目文件", false, error.message); }
  try { await findNpmCli(); add("npm", true, "可用"); } catch (error) { add("npm", false, error.message); }
  const port = await portAvailable(options.port, options.lan ? "0.0.0.0" : "127.0.0.1");
  add("服务端口", port.available, `${options.port}：${port.reason}；可通过 PORT 指定其他端口`);
  console.log("\n方舟启动自检（只检查，不修改文件、不调用模型）\n");
  for (const check of checks) console.log(`${check.ok ? "[就绪]" : "[待处理]"} ${check.name}：${check.detail}`);
  console.log(`\n访问方式：${options.lan ? "可信局域网，手机需配对" : "仅本机；加 --lan 可启用手机连接"}`);
  const { dockerRuntime } = await import("../server/docker-runtime.mjs");
  const automatic = await dockerRuntime().capability();
  console.log(`\n全自动开发与部署：${automatic.available ? "可用" : "待配置"} · ${automatic.reason}`);
  if (state && !state.installNeeded && Number(process.versions.node.split(".")[0]) >= 24) {
    const { diagnoseSandbox } = await import(pathToFileURL(path.join(projectRoot, "server", "project-sandbox.mjs")).href);
    const report = await diagnoseSandbox();
    console.log(`\n工程隔离验证：${report.available ? "可用" : "暂不可用"}`);
    for (const check of report.checks) console.log(`  ${check.label}：${check.detail}${check.action ? ` ${check.action}` : ""}`);
  } else {
    console.log("\n工程隔离验证：需要 Node.js 24+、Linux、bubblewrap、systemd 用户服务及 Chromium。基础工作台可先使用，安装后在设置中检查环境。");
  }
  return checks.every((check) => check.ok);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  doctor(process.argv.slice(2)).then((ready) => { process.exitCode = ready ? 0 : 1; }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
