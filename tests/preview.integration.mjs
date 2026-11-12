import { waitForHttp } from "./helpers/http.mjs";
// Linux only, deliberately fails if isolation is unavailable. Never execute generated fixtures on the host.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { inflateSync } from "node:zlib";
import { launchPreview } from "../server/preview-sandbox.mjs";
import { assembleBundle } from "../server/project-bundle.mjs";
import { childEnv, sandboxAvailable } from "../server/project-sandbox.mjs";
import { fullstackFixture } from "./fixtures/fullstack.mjs";
import { removeTestDirectory } from "./helpers/filesystem.mjs";

function firstPixel(frame) {
  const png = Buffer.from(frame.png, "base64");
  assert.equal(png[24], 8);
  assert.ok([2, 6].includes(png[25]));
  const compressed = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at),
      type = png.subarray(at + 4, at + 8).toString();
    if (type === "IDAT") compressed.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  // Every PNG row filter uses zero neighbours for the very first RGB pixel.
  return [...inflateSync(Buffer.concat(compressed)).subarray(1, 4)];
}
function fixture(marker, injected = "") {
  const bundle = fullstackFixture();
  bundle.files.find((file) => file.path === "src/main.jsx").content =
    `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import './styles.css';${injected}function App(){const[value,setValue]=useState(''),[rows,setRows]=useState([]);async function load(){setRows(await(await fetch('/api/notes')).json())}useEffect(()=>{load()},[]);useEffect(()=>{document.body.style.background=rows.some(r=>r.title===${JSON.stringify(marker)})?'rgb(16,185,129)':'rgb(200,200,200)'},[rows]);return <form onSubmit={async e=>{e.preventDefault();await fetch('/api/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:value})});await load()}}><input aria-label="title" value={value} onChange={e=>setValue(e.target.value)}/><button>save</button></form>}createRoot(document.getElementById('root')).render(<App/>);`;
  bundle.files.find((file) => file.path === "src/styles.css").content =
    "body{margin:0;background:rgb(200,200,200)}input{position:absolute;left:40px;top:60px;width:250px;height:36px}button{position:absolute;left:40px;top:120px;width:120px;height:36px}";
  return bundle;
}
async function untilPixel(preview, expected) {
  let frame;
  for (let i = 0; i < 20; i++) {
    frame = await preview.request({ type: "frame" });
    if (firstPixel(frame).join() === expected.join()) return frame;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.deepEqual(firstPixel(frame), expected);
}

test(
  "real preview clicks, types, saves SQLite, restarts without browser cache, supports mobile and kills its service",
  { timeout: 180000 },
  async (t) => {
    const capability = await sandboxAvailable();
    assert.equal(capability.available, true, capability.reason);
    const marker = "preview-" + randomUUID();
    const preview = await launchPreview(await assembleBundle(fixture(marker)));
    t.after(() => preview.close());
    await untilPixel(preview, [200, 200, 200]);
    await preview.request({ type: "click", x: 100, y: 80 });
    await preview.request({ type: "text", value: marker });
    await preview.request({ type: "click", x: 100, y: 140 });
    await untilPixel(preview, [16, 185, 129]);
    await preview.request({ type: "restart" });
    const persisted = await untilPixel(preview, [16, 185, 129]);
    assert.equal(persisted.width, 1280);
    const mobile = await preview.request({ type: "viewport", mode: "mobile" });
    assert.equal(mobile.width, 390);
    assert.equal(mobile.height, 844);
    assert.deepEqual(firstPixel(mobile), [16, 185, 129]);
    await fs.mkdir("artifacts", { recursive: true });
    await fs.writeFile(
      "artifacts/preview-real-desktop.png",
      Buffer.from(persisted.png, "base64"),
    );
    await fs.writeFile(
      "artifacts/preview-real-mobile.png",
      Buffer.from(mobile.png, "base64"),
    );
    await preview.close();
    assert.equal(preview.alive(), false);
    const units = execFileSync(
      "/usr/bin/systemctl",
      [
        "--user",
        "list-units",
        "--state=running",
        "--no-legend",
        "ark-preview-*.service",
      ],
      { env: childEnv, encoding: "utf8" },
    );
    assert.equal(units.trim(), "");
  },
);

test(
  "real preview denies host files/network, read-only script modification, and browser navigation to the workbench",
  { timeout: 180000 },
  async (t) => {
    assert.equal((await sandboxAvailable()).available, true);
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "ark-preview-host-"),
    );
    await fs.writeFile(path.join(directory, "secret"), "private fixture");
    let contacted = false;
    const server = http
      .createServer((_req, res) => {
        contacted = true;
        res.end("host");
      })
      .listen(0, "127.0.0.1");
    await waitForHttp(server);
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await removeTestDirectory(directory);
    });
    const target = `http://127.0.0.1:${server.address().port}/api/config`;
    const bundle = fixture(
      "unused",
      `fetch(${JSON.stringify(target)}).catch(()=>{});`,
    );
    const backend = bundle.files.find((file) => file.path === "server/app.mjs");
    backend.content =
      `import fs from'node:fs';import assert from'node:assert/strict';assert.equal(fs.existsSync(${JSON.stringify(directory)}),false);assert.equal(fs.existsSync(${JSON.stringify(path.resolve(".local"))}),false);assert.equal(fs.existsSync('/entry.mjs'),false);assert.equal(fs.existsSync('/tmp/preview-data'),false);assert.throws(()=>fs.writeFileSync('/work/scripts/build.mjs','tamper'),/EROFS|EACCES|read-only/);for(const pid of fs.readdirSync('/proc').filter(n=>/^\\d+$/.test(n))){let cmd='';try{cmd=fs.readFileSync('/proc/'+pid+'/cmdline','utf8')}catch{}assert.equal(cmd.includes('/entry.mjs'),false,'trusted controller process must be outside application PID namespace')}await assert.rejects(fetch(${JSON.stringify(target)},{signal:AbortSignal.timeout(500)}));\n` +
      backend.content;
    const preview = await launchPreview(await assembleBundle(bundle));
    t.after(() => preview.close());
    await untilPixel(preview, [200, 200, 200]);
    assert.equal(contacted, false);
    await preview.close();
  },
);

test(
  "real preview startup cancellation cleans its process tree and never returns a running session",
  { timeout: 120000 },
  async () => {
    assert.equal((await sandboxAvailable()).available, true);
    const bundle = fixture("unused");
    bundle.files.find((file) => file.path === "server/app.mjs").content =
      "while(true){}";
    const abort = new AbortController();
    const launching = launchPreview(await assembleBundle(bundle), {
      signal: abort.signal,
    });
    const timer = setTimeout(() => abort.abort(), 3000);
    try {
      await assert.rejects(launching);
    } finally {
      clearTimeout(timer);
    }
    const units = execFileSync(
      "/usr/bin/systemctl",
      [
        "--user",
        "list-units",
        "--state=running",
        "--no-legend",
        "ark-preview-*.service",
      ],
      { env: childEnv, encoding: "utf8" },
    );
    assert.equal(units.trim(), "");
  },
);
