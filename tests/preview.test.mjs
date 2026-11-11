import { waitForHttp } from "./helpers/http.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { z } from "zod";
import { previewApi } from "../server/preview-api.mjs";
import {
  launchPreview,
  validatePreviewFrame,
  PREVIEW_MAX_FRAME_BYTES,
} from "../server/preview-sandbox.mjs";
import { diagnoseSandbox } from "../server/project-sandbox.mjs";
import { createApp } from "../server/index.mjs";
import { openDatabase } from "../server/database.mjs";
import { previewFrame, seedPreview } from "./fixtures/preview.mjs";
import { removeTestDirectory } from "./helpers/filesystem.mjs";

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "ark-preview-test-"),
  );
  const database = openDatabase(directory);
  const seeded = await seedPreview(database);
  let now = 100000,
    allowed = true,
    starts = 0,
    closes = 0,
    alive = true,
    reply = async () => previewFrame();
  const app = express();
  app.use(express.json());
  const controller = previewApi(app, {
    database,
    access: { local: (req) => !req.headers.cookie },
    idle: () => allowed,
    now: () => now,
    capability: async () => ({ available: true }),
    launcher: async () => {
      starts++;
      return {
        frame: previewFrame(),
        alive: () => alive,
        request: (action) => reply(action),
        close: async () => {
          closes++;
          alive = false;
        },
      };
    },
    ...options,
  });
  app.use((error, _req, res, _next) =>
    res
      .status(error instanceof z.ZodError ? 400 : error.status || 500)
      .json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await waitForHttp(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, body, method = body ? "POST" : "GET", cookie) => {
    const response = await fetch(base + "/api" + url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  t.after(async () => {
    await controller.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    database.close();
    await removeTestDirectory(directory);
  });
  return {
    ...seeded,
    database,
    controller,
    request,
    starts: () => starts,
    closes: () => closes,
    advance: (value) => {
      now += value;
    },
    allow: (value) => {
      allowed = value;
    },
    respond: (fn) => {
      reply = fn;
    },
    start: (body = {}) =>
      request(`/software-builds/${seeded.build.id}/preview`, {
        confirmed: true,
        sourceHash: seeded.build.sourceHash,
        ...body,
      }),
  };
}

test("preview requires current true validation, matching source and requirements, explicit consent and an available isolated platform", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.start({ confirmed: false })).status, 400);
  assert.equal((await f.start({ url: "http://localhost" })).status, 400);
  assert.equal((await f.start({ sourceHash: "0".repeat(64) })).status, 409);
  for (const changed of [
    { status: "restored" },
    { validation: { ...f.build.validation, passed: false } },
    { validation: { ...f.build.validation, verificationVersion: 1 } },
    { validation: { ...f.build.validation, sourceHash: "0".repeat(64) } },
    { requirementsHash: "0".repeat(64) },
    {
      files: f.build.files.map((file, i) =>
        i === 0 ? { ...file, content: file.content + "\n" } : file,
      ),
    },
  ]) {
    f.database.saveBuild({ ...f.build, ...changed });
    assert.equal((await f.start()).status, 409);
  }
  assert.equal(f.starts(), 0);
  f.database.saveBuild(f.build);
  f.allow(false);
  assert.equal((await f.start()).status, 409);
  f.allow(true);
  const started = await f.start();
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(f.starts(), 1);
  assert.equal((await f.start()).status, 409);
  assert.equal(
    (await f.request(`/previews/${started.body.id}`, undefined, "DELETE"))
      .status,
    200,
  );
  assert.equal(f.closes(), 1);
  const absent = await fixture(t, {
    capability: () => diagnoseSandbox({ platform: "win32" }),
  });
  assert.equal((await absent.start()).status, 503);
  assert.equal(absent.starts(), 0);
  assert.equal(absent.controller.active(), null);
});

test("preview action API has no navigation/evaluation/file operations, bounds input and rejects cross-device sessions", async (t) => {
  const f = await fixture(t);
  const session = (await f.start()).body;
  for (const action of [
    { type: "goto", url: "http://127.0.0.1:5173/api/config" },
    { type: "evaluate", code: "process.exit()" },
    { type: "key", key: "Control+L" },
    { type: "click", x: 1400, y: 20 },
    { type: "click", x: 20, y: 801 },
    { type: "text", value: "x".repeat(2001) },
    { type: "reload", url: "file:///etc/passwd" },
  ])
    assert.equal(
      (await f.request(`/previews/${session.id}/action`, action)).status,
      400,
    );
  assert.equal(
    (
      await f.request(
        `/previews/${session.id}/action`,
        { type: "frame" },
        "POST",
        "ark_session=other-device",
      )
    ).status,
    404,
  );
  const other = await f.request(
    `/software-builds/${f.build.id}/preview`,
    undefined,
    "GET",
    "ark_session=other-device",
  );
  assert.equal(other.body.session, null);
  assert.equal(JSON.stringify(other.body).includes(session.id), false);
  assert.equal(
    (
      await f.request(`/previews/${session.id}/action`, {
        type: "key",
        key: "Tab",
      })
    ).status,
    200,
  );
  assert.throws(
    () => f.controller.guardWrite({ ...f.state, projects: [] }),
    (error) => error.status === 423,
  );
});

test("frames do not prolong idle lifetime, user input cannot prolong hard expiry, and commands are never queued", async (t) => {
  const f = await fixture(t);
  const session = (await f.start()).body;
  f.advance(89900);
  const frame = await f.request(`/previews/${session.id}/action`, {
    type: "frame",
  });
  assert.equal(frame.status, 200);
  assert.equal(frame.body.idleExpiresAt, session.idleExpiresAt);
  f.advance(101);
  assert.equal(
    (await f.request(`/previews/${session.id}/action`, { type: "frame" }))
      .status,
    410,
  );
  assert.equal(f.closes(), 1);

  const limited = await fixture(t, { lifetimeMs: 20000 });
  const hard = (await limited.start()).body;
  limited.advance(15000);
  assert.equal(
    (
      await limited.request(`/previews/${hard.id}/action`, {
        type: "text",
        value: "a",
      })
    ).status,
    200,
  );
  limited.advance(5001);
  assert.equal(
    (
      await limited.request(`/previews/${hard.id}/action`, {
        type: "text",
        value: "b",
      })
    ).status,
    410,
  );

  const serial = await fixture(t);
  const s = (await serial.start()).body;
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  serial.respond(() => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const first = serial.request(`/previews/${s.id}/action`, { type: "frame" });
  await started;
  assert.equal(
    (await serial.request(`/previews/${s.id}/action`, { type: "frame" }))
      .status,
    409,
  );
  release(previewFrame());
  assert.equal((await first).status, 200);
});

test("malformed/oversized frames stop preview and shutdown awaits a late-starting sandbox", async (t) => {
  assert.throws(
    () => validatePreviewFrame({ ...previewFrame(), width: 1 }),
    /格式|PNG/,
  );
  assert.throws(
    () =>
      validatePreviewFrame({
        png: Buffer.alloc(PREVIEW_MAX_FRAME_BYTES + 1).toString("base64"),
        width: 1280,
        height: 800,
      }),
    /格式|PNG/,
  );
  const f = await fixture(t);
  const session = (await f.start()).body;
  f.respond(async () => ({
    png: "<html>bad</html>",
    width: 1280,
    height: 800,
  }));
  assert.equal(
    (await f.request(`/previews/${session.id}/action`, { type: "frame" }))
      .status,
    500,
  );
  assert.equal(f.closes(), 1);
  assert.equal(f.controller.active(), null);

  let release,
    entered,
    cleaned = false;
  const launched = new Promise((resolve) => {
    entered = resolve;
  });
  const late = await fixture(t, {
    launcher: async () => {
      entered();
      await new Promise((resolve) => {
        release = resolve;
      });
      return {
        frame: previewFrame(),
        alive: () => true,
        close: async () => {
          cleaned = true;
        },
      };
    },
  });
  const start = late.start();
  await launched;
  const stop = late.controller.close();
  release();
  await stop;
  assert.equal(cleaned, true);
  assert.notEqual((await start).status, 200);
});

test("application guard denies cross-origin preview commands and active preview blocks migration and workspace changes", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "ark-preview-api-"),
  );
  const db = openDatabase(directory);
  const { build } = await seedPreview(db);
  db.close();
  let cleaned = false;
  const app = createApp({
    shared: true,
    configPath: path.join(directory, "ai-config.json"),
    previewOptions: {
      capability: async () => ({ available: true }),
      launcher: async () => ({
        frame: previewFrame(),
        alive: () => !cleaned,
        request: async () => previewFrame(),
        close: async () => {
          cleaned = true;
        },
      }),
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await waitForHttp(server);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (url, body, headers = {}) =>
    fetch(base + url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  t.after(async () => {
    await app.locals.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await removeTestDirectory(directory);
  });
  const payload = { confirmed: true, sourceHash: build.sourceHash };
  assert.equal(
    (
      await post(`/software-builds/${build.id}/preview`, payload, {
        Origin: "https://other.example",
      })
    ).status,
    403,
  );
  const started = await post(`/software-builds/${build.id}/preview`, payload);
  assert.equal(started.status, 200, await started.clone().text());
  const status = await (await fetch(base + "/storage-status")).json();
  assert.equal(
    (
      await post("/snapshots/prune", {
        confirmed: true,
        revision: status.revision,
        snapshotFingerprint: status.snapshots.fingerprint,
      })
    ).status,
    409,
  );
  const workspace = await (await fetch(base + "/workspace")).json();
  workspace.state.projects[0].goal = "changed while previewing";
  assert.equal(
    (
      await fetch(base + "/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workspace),
      })
    ).status,
    423,
  );
  await app.locals.close();
  assert.equal(cleaned, true);
});

test("a failed startup cleanup keeps the execution lock and can be retried", async (t) => {
  let allowCleanup = false,
    attempted = 0;
  const f = await fixture(t, {
    launcher: async (_files, { onCleanup }) => {
      onCleanup(async () => {
        attempted++;
        if (!allowCleanup) throw new Error("cleanup unconfirmed");
      });
      throw new Error("startup failed after process creation");
    },
  });
  assert.equal((await f.start()).status, 500);
  assert.ok(attempted > 0);
  assert.equal(f.controller.active().buildId, f.build.id);
  assert.equal((await f.start()).status, 409);
  allowCleanup = true;
  await f.controller.close();
  assert.equal(f.controller.active(), null);
});

test(
  "unsupported host preview never executes files outside isolation",
  { skip: process.platform === "linux" },
  async () => {
    await assert.rejects(
      launchPreview([{ path: "bad", content: "never execute" }]),
      /需要 Linux/,
    );
  },
);
