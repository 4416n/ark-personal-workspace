import { test } from "node:test";
import assert from "node:assert/strict";
import { caddyPublisher } from "../server/autopilot-publisher.mjs";

test("automatic publisher creates and updates only project-specific HTTPS routes", async () => {
  const requests = [];
  let exists = false;
  const publisher = caddyPublisher({ domain: "apps.example.com", fetcher: async (url, options) => {
    requests.push({ url: url.toString(), ...options });
    if (options.method === "GET") return { ok: exists, status: exists ? 200 : 404 };
    exists = true;
    return { ok: true, status: 200 };
  } });
  const url = await publisher.publish("project-id", 8800);
  assert.match(url, /^https:\/\/app-[a-f0-9]{16}\.apps\.example\.com$/);
  const first = requests.find((request) => request.method === "PUT");
  assert.ok(first.url.endsWith("/config/apps/http/servers/srv0/routes/0"));
  const route = JSON.parse(first.body);
  assert.equal(route.handle[0].upstreams[0].dial, "127.0.0.1:8800");
  assert.equal(route.match[0].host[0], new URL(url).hostname);
  assert.equal(await publisher.publish("project-id", 8800), url);
  assert.ok(requests.some((request) => request.method === "PATCH" && /\/id\/ark-auto-/.test(request.url)));
});

test("publisher rejects remote admin endpoints, unsafe domains and failed route updates", async () => {
  for (const domain of ["https://apps.example.com", "example.com/path", "evil;example.com"])
    assert.throws(() => caddyPublisher({ domain }), /无效/);
  for (const adminUrl of ["http://remote.example:2019", "http://user@localhost:2019", "http://localhost:2019/path"])
    assert.throws(() => caddyPublisher({ domain: "example.com", adminUrl }), /本机/);
  const publisher = caddyPublisher({ domain: "example.com", fetcher: async () => ({ ok: false, status: 500 }) });
  await assert.rejects(publisher.publish("id", 8800), /读取 Caddy/);
});
