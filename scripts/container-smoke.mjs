import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { hashPassword } from "../server/deployment.mjs";
import { projectRoot } from "./workspace-setup.mjs";

const passwordFile = path.join(projectRoot, ".local", "container-smoke-password");
if (process.argv.includes("--prepare")) {
  const password = randomBytes(32).toString("hex");
  await fs.mkdir(path.dirname(passwordFile), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(projectRoot, "deploy"), { recursive: true });
  await fs.writeFile(passwordFile, password, { mode: 0o600 });
  await fs.writeFile(path.join(projectRoot, "deploy/password.hash"), await hashPassword(password), { mode: 0o644, flag: "wx" });
  console.log("Prepared temporary container credentials");
} else {
  const base = process.env.ARK_SMOKE_URL || "http://127.0.0.1:5187";
  const password = await fs.readFile(passwordFile, "utf8");
  const until = Date.now() + 30000;
  let ready = false;
  while (Date.now() < until) {
    try {
      const health = await fetch(base + "/api/health", { signal: AbortSignal.timeout(2000) });
      if (health.ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Production container did not become healthy");
  assert.equal((await fetch(base + "/api/workspace")).status, 401);
  const login = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const headers = { Cookie: cookie, Origin: base, "Content-Type": "application/json" };
  const snapshot = await (await fetch(base + "/api/workspace", { headers })).json();
  if (process.argv.includes("--restored")) {
    assert.equal(snapshot.state.profile.name, "Container smoke check");
  } else {
    const state = { version: 1, profile: { name: "Container smoke check", role: "", focus: "" }, members: [], projects: [], tasks: [], knowledge: [], departments: [], activity: [], messages: [] };
    const saved = await fetch(base + "/api/workspace", { method: "PUT", headers, body: JSON.stringify({ revision: snapshot.revision, state }) });
    assert.equal(saved.status, 200);
  }
  assert.equal((await fetch(base + "/api/auth/logout", { method: "POST", headers, body: "{}" })).status, 200);
  assert.equal((await fetch(base + "/api/workspace", { headers })).status, 401);
  console.log("Production container authentication and persistence passed");
}
