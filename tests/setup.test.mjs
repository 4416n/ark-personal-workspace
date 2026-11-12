import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { inspectWorkspace, supportedNode, launchOptions, portAvailable } from "../scripts/workspace-setup.mjs";
import { removeTestDirectory } from "./helpers/filesystem.mjs";

test("launcher validates supported Node and explicit LAN/port options", () => {
  for (const version of ["18.20.0", "20.19.0", "22.17.9"]) assert.equal(supportedNode(version), false);
  for (const version of ["22.18.0", "24.0.0", "v26.1.0"]) assert.equal(supportedNode(version), true);
  assert.equal(launchOptions([], {}).lan, false);
  assert.equal(launchOptions(["--lan", "--no-open"], { PORT: "5188" }).port, 5188);
  assert.throws(() => launchOptions([], { PORT: "hello" }), /PORT/);
  assert.throws(() => launchOptions(["--public"], {}), /不认识/);
});
test("launcher finds first install/build and avoids repeating it until inputs change", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ark-setup-"));
  t.after(() => removeTestDirectory(root));
  const write = async (name, value) => { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), value); };
  const lock = { packages: { "node_modules/example": { version: "1.0.0", integrity: "one" }, "node_modules/transitive": { version: "1.0.0", integrity: "two" } } };
  await write("package.json", JSON.stringify({ version: "1.0.0", dependencies: { example: "1.0.0" } }));
  await write("package-lock.json", JSON.stringify(lock));
  for (const dir of ["src", "shared", "server", "public"]) await fs.mkdir(path.join(root, dir));
  for (const name of ["index.html", "vite.config.ts", "tsconfig.json", "src/App.tsx"]) await write(name, "source");
  let state = await inspectWorkspace(root);
  assert.equal(state.installNeeded, true);
  assert.equal(state.buildNeeded, true);
  await write("node_modules/example/package.json", JSON.stringify({ version: "1.0.0" }));
  await write("node_modules/.package-lock.json", JSON.stringify(lock));
  await write("dist/index.html", "built");
  const future = new Date(Date.now() + 60000);
  await fs.utimes(path.join(root, "dist/index.html"), future, future);
  state = await inspectWorkspace(root);
  assert.equal(state.installNeeded, false);
  assert.equal(state.buildNeeded, false);
  const newer = new Date(future.getTime() + 1000);
  await fs.utimes(path.join(root, "src/App.tsx"), newer, newer);
  assert.equal((await inspectWorkspace(root)).buildNeeded, true);
  lock.packages["node_modules/transitive"].version = "2.0.0";
  await write("package-lock.json", JSON.stringify(lock));
  assert.equal((await inspectWorkspace(root)).installNeeded, true);
});
test("port preflight reports occupied sockets without closing the existing service", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try { assert.equal((await portAvailable(port)).available, false); assert.equal(server.listening, true); }
  finally { await new Promise((resolve) => server.close(resolve)); }
  assert.equal((await portAvailable(port)).available, true);
});
