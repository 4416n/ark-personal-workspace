import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { blockedHttpPorts, waitForHttp } from "./helpers/http.mjs";

test("HTTP fixtures retry an OS-assigned forbidden port and remain reachable through Fetch", async (t) => {
  const server = http.createServer((_req, res) => res.end("ready"));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const initial = server.address().port;
  await waitForHttp(server, new Set([...blockedHttpPorts, initial]));
  const next = server.address().port;
  assert.notEqual(next, initial);
  assert.equal(blockedHttpPorts.has(next), false);
  assert.equal(await (await fetch(`http://127.0.0.1:${next}`)).text(), "ready");
});
