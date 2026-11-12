import { waitForHttp } from "./helpers/http.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseSandbox } from "../server/project-sandbox.mjs";
import { softwareDelivery } from "../server/software.mjs";
import { createApp } from "../server/index.mjs";
import http from "node:http";

const mockEnvironment = (overrides = {}) => ({
  platform: "linux",
  nodeVersion: "24.0.0",
  dependencies: async () => [],
  inspectFile: async () => {},
  run: async () => ({ code: 0, over: false }),
  chromiumPath: async () => "/mock/chromium",
  ...overrides,
});
const check = (result, id) => result.checks.find((item) => item.id === id);

test("Windows/macOS diagnostics never invoke Linux tools, dependencies or browser probes", async () => {
  for (const platform of ["win32", "darwin"]) {
    let probes = 0;
    const forbidden = async () => {
      probes++;
      throw new Error("must not probe");
    };
    const result = await diagnoseSandbox(
      mockEnvironment({
        platform,
        dependencies: forbidden,
        inspectFile: forbidden,
        run: forbidden,
        chromiumPath: forbidden,
      }),
    );
    assert.equal(result.available, false);
    assert.equal(check(result, "platform").status, "unsupported");
    assert.equal(check(result, "node").status, "passed");
    assert.match(result.reason, /未验证源码/);
    assert.equal(result.checks.length, 7);
    assert.equal(probes, 0);
  }
});

test("diagnostics report all missing prerequisites independently and do not run isolation without user service", async () => {
  const commands = [];
  const result = await diagnoseSandbox(
    mockEnvironment({
      nodeVersion: "22.18.0",
      dependencies: async () => {
        throw new Error("锁文件依赖不一致");
      },
      inspectFile: async (file) => {
        if (file === "/mock/chromium") throw new Error("ENOENT");
      },
      run: async (cmd, _args, limits) => {
        commands.push(cmd);
        assert.ok(limits.timeout <= 10000);
        return { code: 1, over: false };
      },
    }),
  );
  assert.equal(result.available, false);
  assert.deepEqual(
    result.checks
      .filter((item) => item.status === "failed")
      .map((item) => item.id),
    ["node", "systemd", "dependencies", "chromium"],
  );
  assert.equal(check(result, "isolation").status, "unsupported");
  assert.deepEqual(commands, ["/usr/bin/systemctl"]);
  assert.ok(
    result.checks
      .filter((item) => item.status === "failed")
      .every((item) => item.action),
  );
});

test("missing isolation tools do not run subprocesses, and passing prerequisites still require a successful isolation probe", async () => {
  let calls = 0;
  const absent = await diagnoseSandbox(
    mockEnvironment({
      inspectFile: async (file) => {
        if (file === "/usr/bin/bwrap") throw new Error("ENOENT");
      },
      run: async () => {
        calls++;
        return { code: 0 };
      },
    }),
  );
  assert.equal(absent.available, false);
  assert.equal(check(absent, "tools").status, "failed");
  assert.equal(calls, 0);

  const blocked = await diagnoseSandbox(
    mockEnvironment({
      run: async (cmd, args) => {
        if (cmd === "/usr/bin/systemctl") return { code: 0 };
        assert.ok(args.includes("--unshare-all"));
        assert.ok(args.includes("--property=MemoryMax=1024M"));
        assert.ok(args.includes("--property=RuntimeMaxSec=8"));
        assert.equal(args.at(-1), "/usr/bin/true");
        return { code: 1 };
      },
    }),
  );
  assert.equal(blocked.available, false);
  assert.equal(check(blocked, "isolation").status, "failed");
  assert.match(blocked.reason, /不会执行未隔离代码/);

  const ready = await diagnoseSandbox(mockEnvironment());
  assert.equal(ready.available, true);
  assert.ok(ready.checks.every((item) => item.status === "passed"));
  assert.ok(Number.isFinite(Date.parse(ready.checkedAt)));
});

test("capability refresh coalesces concurrent requests, throttles probes and retains compatibility with legacy providers", async (t) => {
  let now = 100000;
  t.mock.method(Date, "now", () => now);
  let calls = 0,
    release;
  const delivery = softwareDelivery({
    database: null,
    capability: async () => {
      calls++;
      if (calls === 1)
        await new Promise((resolve) => {
          release = resolve;
        });
      return { available: calls > 1, reason: "mock only" };
    },
    readConfig: async () => {
      throw new Error("diagnostics must not read model configuration");
    },
    completion: async () => {
      throw new Error("diagnostics must not invoke a model");
    },
  });
  t.after(() => delivery.close());
  const first = delivery.capabilities();
  const concurrent = delivery.capabilities({ refresh: true });
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  const results = await Promise.all([first, concurrent]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].available, false);
  now += 4999;
  await delivery.capabilities({ refresh: true });
  assert.equal(calls, 1);
  now++;
  assert.equal(
    (await delivery.capabilities({ refresh: true })).available,
    true,
  );
  assert.equal(calls, 2);
  now += 29999;
  await delivery.capabilities();
  assert.equal(calls, 2);
  now++;
  await delivery.capabilities();
  assert.equal(calls, 3);
});

test("failed probes do not poison subsequent capability requests", async (t) => {
  let calls = 0;
  const delivery = softwareDelivery({
    database: null,
    capability: async () => {
      if (++calls === 1) throw new Error("probe unavailable");
      return { available: false, reason: "recovered diagnostics" };
    },
  });
  t.after(() => delivery.close());
  await assert.rejects(delivery.capabilities(), /probe unavailable/);
  assert.equal((await delivery.capabilities()).reason, "recovered diagnostics");
  assert.equal(calls, 2);
});

test("capabilities API returns diagnostics, honors refresh and rejects untrusted hosts before probing", async (t) => {
  let now = 100000,
    calls = 0;
  t.mock.method(Date, "now", () => now);
  const app = createApp({
    shared: false,
    softwareOptions: {
      capability: async () => {
        calls++;
        return diagnoseSandbox(mockEnvironment({ platform: "win32" }));
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await waitForHttp(server);
  t.after(async () => {
    await app.locals.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/software-capabilities`;
  const initial = await (await fetch(url)).json();
  assert.equal(initial.available, false);
  assert.equal(check(initial, "platform").status, "unsupported");
  assert.equal(calls, 1);
  now += 5000;
  assert.equal((await fetch(url + "?refresh=1")).status, 200);
  assert.equal(calls, 2);
  now += 5000;
  const rejected = await new Promise((resolve, reject) => {
    http
      .get(
        url + "?refresh=1",
        { headers: { Host: "untrusted.example" } },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        },
      )
      .on("error", reject);
  });
  assert.equal(rejected, 403);
  assert.equal(calls, 2);
});
