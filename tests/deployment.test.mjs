import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createApp } from "../server/index.mjs";
import { hashPassword, verifyPassword, deploymentConfig } from "../server/deployment.mjs";
import { emptyWorkspace } from "../src/domain.ts";
import { waitForHttp } from "./helpers/http.mjs";
import { removeTestDirectory } from "./helpers/filesystem.mjs";

const password = "a-strong-workspace-password";
const passwordHash = await hashPassword(password);
const origin = "https://ark.example.com";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("remote deployment rejects incomplete, insecure and ambiguous configuration", async () => {
  assert.equal(deploymentConfig(), null);
  for (const publicOrigin of ["http://example.com", "https://user@example.com", "https://example.com/path", "https://example.com?x=1", "https://example.com#hash", "bad-url"])
    assert.throws(() => deploymentConfig({ publicOrigin, passwordHash }));
  assert.throws(() => deploymentConfig({ publicOrigin: origin }));
  assert.throws(() => deploymentConfig({ passwordHash }));
  assert.throws(() => deploymentConfig({ publicOrigin: origin, passwordHash: "plain-text-password" }));
  assert.equal(deploymentConfig({ publicOrigin: origin + "/", passwordHash }).origin, origin);
  assert.ok(deploymentConfig({ publicOrigin: "http://127.0.0.1:5173", passwordHash }));
  assert.throws(() => createApp({ deployment: { publicOrigin: origin, passwordHash } }));
  for (const invalid of ["short", "x".repeat(257), null]) await assert.rejects(hashPassword(invalid));
  assert.equal(await verifyPassword(password, passwordHash), true);
  for (const invalid of ["incorrect-password", null, {}, "x".repeat(257)])
    assert.equal(await verifyPassword(invalid, passwordHash), false);
  assert.notEqual(await hashPassword(password), passwordHash);
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-deploy-"));
  const app = createApp({ shared: true, configPath: path.join(directory, "ai.json"), deployment: { publicOrigin: origin, passwordHash } });
  const server = app.listen(0, "127.0.0.1");
  await waitForHttp(server);
  t.after(async () => {
    await app.locals.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await removeTestDirectory(directory);
  });
  const request = (route, { body, method = body === undefined ? "GET" : "POST", headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1", port: server.address().port, path: route, method,
        headers: { Host: "ark.example.com", "Content-Type": "application/json", ...(body === undefined ? {} : { Origin: origin }), ...headers },
      }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => text += chunk);
        res.on("end", () => {
          let data;
          try { data = JSON.parse(text); } catch { data = text; }
          resolve({ status: res.statusCode, headers: res.headers, data });
        });
      });
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  return { request };
}

test("remote login protects loopback/proxy requests, validates origins and grants revocable owner sessions", async (t) => {
  const { request } = await fixture(t);
  const session = await request("/api/session");
  assert.equal(session.data.remote, true);
  assert.equal(session.data.local, false);
  assert.equal(session.data.authenticated, false);
  assert.equal((await request("/api/workspace")).status, 401);
  assert.equal((await request("/api/workspace", { headers: { Host: "localhost", "X-Forwarded-Host": "ark.example.com" } })).status, 403);
  assert.equal((await request("/api/auth/login", { body: { password }, headers: { Origin: "http://ark.example.com" } })).status, 403);
  assert.equal((await request("/api/auth/login", { body: { password }, headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await request("/api/auth/login", { body: { password }, headers: { Origin: "" } })).status, 403);
  assert.equal((await request("/api/session", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await request("/api/auth/login", { body: { password: "wrong-password" } })).status, 401);
  const login = await request("/api/auth/login", { body: { password } });
  assert.equal(login.status, 200);
  const cookie = login.headers["set-cookie"][0].split(";")[0];
  assert.match(login.headers["set-cookie"][0], /HttpOnly; SameSite=Strict/);
  assert.match(login.headers["set-cookie"][0], /; Secure/);
  const headers = { Cookie: cookie };
  assert.equal((await request("/api/session", { headers })).data.local, true);
  const saved = await request("/api/workspace", { method: "PUT", body: { revision: 0, state: emptyWorkspace() }, headers });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.revision, 1);
  assert.equal((await request("/api/config", { headers })).status, 200);
  assert.equal((await request("/api/full-backup", { headers })).status, 200);
  assert.equal((await request("/api/connection/code", { body: {}, headers })).status, 400);
  assert.equal((await request("/api/pair", { body: { code: "12345678" }, headers })).status, 404);
  assert.equal((await request("/api/auth/logout", { body: {}, headers })).status, 200);
  assert.equal((await request("/api/workspace", { headers })).status, 401);
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.headers["cache-control"], "no-store");
  assert.equal(health.headers["x-frame-options"], "DENY");
  assert.match(health.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(health.headers["strict-transport-security"], /max-age/);
});

test("remote password attempts are bounded even when forwarded IP headers change", async (t) => {
  const { request } = await fixture(t);
  for (let attempt = 0; attempt < 8; attempt++) {
    const result = await request("/api/auth/login", { body: { password: "wrong-password" }, headers: { "X-Forwarded-For": `10.0.0.${attempt}` } });
    assert.equal(result.status, 401);
  }
  assert.equal((await request("/api/auth/login", { body: { password } })).status, 429);
  assert.equal((await request("/api/workspace")).status, 401);
});

test("password setup reads stdin, writes only a salted hash and rejects invalid input atomically", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-password-"));
  t.after(() => removeTestDirectory(directory));
  const target = path.join(directory, "password.hash");
  const execute = (input, extra = []) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(projectRoot, "scripts/set-password.mjs"), "--stdin", "--output", target, ...extra], { cwd: directory, windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => output += chunk);
    child.stderr.on("data", (chunk) => output += chunk);
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output }));
    child.stdin.end(input);
  });
  const result = await execute(password + "\r\n");
  assert.equal(result.code, 0);
  assert.ok(!result.output.includes(password));
  const hash = (await fs.readFile(target, "utf8")).trim();
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal((await execute("short\n")).code, 1);
  assert.equal((await fs.readFile(target, "utf8")).trim(), hash);
  assert.equal((await execute(password + "\n", ["--invalid"])).code, 1);
});
