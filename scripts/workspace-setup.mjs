import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function supportedNode(version) {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 18);
}
export function launchOptions(args = [], env = process.env) {
  const allowed = new Set(["--lan", "--no-open", "--help", "--check"]);
  for (const arg of args) if (!allowed.has(arg)) throw new Error(`不认识的参数：${arg}`);
  const port = Number(env.PORT || 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT 必须是 1–65535 的整数");
  return { lan: args.includes("--lan"), open: !args.includes("--no-open"), help: args.includes("--help"), check: args.includes("--check"), port };
}
export async function portAvailable(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", (error) => resolve({ available: false, reason: error.code || error.message }));
    probe.listen(port, host, () => probe.close(() => resolve({ available: true, reason: "空闲" })));
  });
}
async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}
export async function inspectWorkspace(root = projectRoot) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const lockText = await fs.readFile(path.join(root, "package-lock.json"), "utf8");
  const lock = JSON.parse(lockText);
  const lockHash = createHash("sha256").update(lockText).digest("hex");
  const missing = [];
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    try {
      const installed = JSON.parse(await fs.readFile(path.join(root, "node_modules", name, "package.json"), "utf8"));
      if (installed.version !== lock.packages?.[`node_modules/${name}`]?.version) missing.push(name);
    } catch { missing.push(name); }
  }
  // npm records the installed transitive tree separately. Compare entries
  // present on this platform so optional Linux/Windows packages do not cause
  // every launch to reinstall the dependencies.
  let treeChanged = false;
  try {
    const installedTree = JSON.parse(await fs.readFile(path.join(root, "node_modules", ".package-lock.json"), "utf8"));
    treeChanged = Object.entries(installedTree.packages || {}).some(([name, spec]) =>
      !lock.packages?.[name] || lock.packages[name].version !== spec.version || lock.packages[name].integrity !== spec.integrity);
  } catch { treeChanged = true; }
  const markerPath = path.join(root, "node_modules", ".cache", "ark-launch.json");
  let previous;
  try { previous = JSON.parse(await fs.readFile(markerPath, "utf8")); } catch { previous = null; }
  const installNeeded = missing.length > 0 || treeChanged || (!!previous && previous.lockHash !== lockHash);
  const index = path.join(root, "dist", "index.html");
  const built = await exists(index);
  let buildNeeded = !built || installNeeded;
  if (built && !buildNeeded) {
    const builtAt = (await fs.stat(index)).mtimeMs;
    async function newer(name) {
      const stat = await fs.stat(name);
      if (!stat.isDirectory()) return stat.mtimeMs > builtAt;
      for (const item of await fs.readdir(name, { withFileTypes: true })) {
        if (item.isSymbolicLink()) continue;
        if (await newer(path.join(name, item.name))) return true;
      }
      return false;
    }
    for (const relative of ["src", "shared", "server", "public", "index.html", "vite.config.ts", "tsconfig.json", "package-lock.json"])
      if (await newer(path.join(root, relative))) { buildNeeded = true; break; }
  }
  return { root, version: manifest.version, missing, installNeeded, buildNeeded, built, lockHash, markerPath };
}
export async function findNpmCli(root = projectRoot) {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    ...String(process.env.PATH || "").split(path.delimiter).flatMap((directory) => [
      path.join(directory, "node_modules", "npm", "bin", "npm-cli.js"),
      path.join(directory, "npm"),
    ]),
    path.join(root, "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const resolved = await fs.realpath(candidate);
      if (path.basename(resolved) === "npm-cli.js") return resolved;
    } catch { /* Try the next Node/npm installation. */ }
  }
  throw new Error("未找到 npm。请安装包含 npm 的 Node.js LTS，再重新启动。");
}
