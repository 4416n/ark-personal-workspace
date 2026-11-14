import { test } from "node:test";
import assert from "node:assert/strict";
import { dockerRuntime } from "../server/docker-runtime.mjs";
import { sourceHash } from "../server/project-bundle.mjs";
import { fullstackFixture } from "./fixtures/fullstack.mjs";

test("Docker capability refuses unavailable or Windows engines without attempting generated code", async () => {
  const commands = [];
  const runtime = dockerRuntime({ command: async (args) => { commands.push(args); return "windows"; } });
  assert.equal((await runtime.capability()).available, false);
  const report = await runtime.validate([]);
  assert.equal(report.unavailable, true);
  assert.equal(report.passed, false);
  assert.ok(commands.every((args) => args[0] === "info"));
});

test("generated app containers have no host mounts, privileges or external network", async () => {
  const commands = [];
  const runtime = dockerRuntime({ command: async (args) => { commands.push(args); return args[0] === "port" ? "127.0.0.1:8811" : ""; } });
  await runtime.network("ark-auto-net-test");
  await runtime.startContainer({ name: "ark-auto-app-test", image: "ark-auto-image-test", volume: "ark-auto-data-test", network: "ark-auto-net-test", port: 8811 });
  const run = commands.find((args) => args[0] === "run");
  for (const required of ["--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true", "--pids-limit=128", "--memory=512m"])
    assert.ok(run.includes(required), required);
  assert.ok(run.includes("127.0.0.1:8811:8080"));
  assert.ok(commands[0].includes("--internal"));
  assert.ok(!run.some((arg) => arg.includes("type=bind") || arg.includes("privileged") || arg.includes("docker.sock")));
  await assert.rejects(runtime.startContainer({ name: "other-container", image: "ark-auto-test", volume: "ark-auto-test", network: "ark-auto-test" }), /受管/);
});

test("volume initialization runs only trusted scripts and data copies run without root", async () => {
  const commands = [];
  const runtime = dockerRuntime({ command: async (args) => { commands.push(args); return ""; } });
  await runtime.createVolume("ark-auto-new", "ark-auto-image", "ark-auto-old");
  const runs = commands.filter((args) => args[0] === "run");
  assert.equal(runs.length, 2);
  assert.ok(runs[0].includes("--cap-add=CHOWN"));
  assert.ok(runs[0].includes("--entrypoint=node"));
  assert.ok(runs[1].includes("--user=1000:1000"));
  assert.ok(runs[1].includes("type=volume,src=ark-auto-old,dst=/previous,readonly"));
  assert.ok(runs.every((args) => args.includes("--network=none") && args.includes("--read-only")));
});

test("container cleanup reports daemon failure and tolerates only an absent managed container", async () => {
  const absent = dockerRuntime({ command: async () => { throw new Error("Error: No such container"); } });
  await absent.removeContainer("ark-auto-missing");
  const failed = dockerRuntime({ command: async () => { throw new Error("Docker daemon unavailable"); } });
  await assert.rejects(failed.removeContainer("ark-auto-test"), /unavailable/);
});

test("publishing reuses the exact verified image and rejects missing or mismatched evidence", async () => {
  const files = [{ path: "README.md", content: "verified" }];
  const commands = [];
  const runtime = dockerRuntime({ command: async (args) => { commands.push(args); return args[0] === "image" ? sourceHash(files) : ""; } });
  await runtime.prepareImage(files, "ark-auto-release", { imageId: "sha256:" + "a".repeat(64) });
  assert.ok(commands.some((args) => args[0] === "tag"));
  assert.ok(!commands.some((args) => args[0] === "build"));
  await assert.rejects(runtime.prepareImage(files, "ark-auto-release", {}), /不可变 ID/);
  await assert.rejects(runtime.prepareImage([{ path: "README.md", content: "changed" }], "ark-auto-release", { imageId: "sha256:" + "a".repeat(64) }), /源码不一致/);
});

test("Docker validation binds real lifecycle evidence and fails closed when the immutable image cannot be confirmed", async () => {
  for (const imageId of ["sha256:" + "b".repeat(64), "invalid-image"]) {
    const fixture = fullstackFixture();
    const files = [...fixture.files, { path: "tests/acceptance.json", content: JSON.stringify(fixture.tests) }];
    const commands = [], contexts = [], rows = [];
    let browserValue = "";
    const runtime = dockerRuntime({
      command: async (args) => {
        commands.push(args);
        if (args[0] === "info") return "linux";
        if (args[0] === "port") return "127.0.0.1:8899";
        if (args[0] === "image" && args[1] === "inspect") return imageId;
        const script = args.at(-1);
        if (typeof script === "string" && script.startsWith("import {sqliteContains}")) {
          const values = JSON.parse(/sqliteContains\('\/app\/data',(\[[^\]]+\]),/.exec(script)[1]);
          return "ARK_SQLITE_EVIDENCE=" + JSON.stringify(values.filter((value) => rows.some((row) => row.title === value)));
        }
        return "";
      },
      fetcher: async (url, options = {}) => {
        if (url.endsWith("/healthz")) return { ok: true, json: async () => ({ ok: true }) };
        let status = 200, response;
        if (options.method === "POST") {
          response = { id: rows.length + 1, title: JSON.parse(options.body).title };
          rows.push(response); status = 201;
        } else if (options.method === "PATCH") {
          rows.find((row) => row.id === Number(url.split("/").at(-1))).title = JSON.parse(options.body).title;
          response = { ok: true };
        } else if (options.method === "DELETE") {
          rows.splice(rows.findIndex((row) => row.id === Number(url.split("/").at(-1))), 1);
          response = { ok: true };
        } else response = rows;
        return { status, text: async () => JSON.stringify(response) };
      },
      browserFactory: async () => ({
        newContext: async (options) => {
          const settings = { options, routes: [], sockets: [] };
          contexts.push(settings);
          return {
            route: async (pattern, handler) => settings.routes.push({ pattern, handler }),
            routeWebSocket: async (pattern, handler) => settings.sockets.push({ pattern, handler }),
            close: async () => {},
            newPage: async () => ({
              on: () => {}, goto: async () => {},
              locator: () => ({ fill: async (value) => { browserValue = value; }, click: async () => { rows.push({ id: rows.length + 1, title: browserValue }); } }),
              getByText: (value) => ({ first: () => ({ waitFor: async () => assert.ok(rows.some((row) => row.title === value)) }) }),
              evaluate: async () => true,
              screenshot: async () => Buffer.from("mock screenshot"),
            }),
          };
        },
        close: async () => {},
      }),
    });
    const report = await runtime.validate(files);
    assert.equal(report.passed, imageId.startsWith("sha256:"), report.logs);
    assert.equal(report.coverage.browser, true);
    assert.equal(report.coverage.update, true);
    assert.equal(report.coverage.remove, true);
    assert.equal(contexts.length, 2);
    for (const context of contexts) {
      assert.equal(context.options.serviceWorkers, "block");
      assert.equal(context.options.acceptDownloads, false);
      assert.equal(context.routes.length, 1);
      assert.equal(context.sockets.length, 1);
      let aborted = false, continued = false;
      await context.routes[0].handler({ request: () => ({ url: () => "http://127.0.0.1:5173/api/config" }), abort: () => { aborted = true; }, continue: () => { continued = true; } });
      assert.equal(aborted, true);
      assert.equal(continued, false);
    }
    assert.equal(commands.some((args) => args[0] === "image" && args[1] === "rm"), !report.passed);
    if (!report.passed) assert.match(report.logs, /不可变 ID/);
  }
});
