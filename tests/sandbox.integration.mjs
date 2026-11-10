// Deliberately opt-in. Runs generated fixture code ONLY through project-sandbox.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import {
  validateProject,
  sandboxAvailable,
} from "../server/project-sandbox.mjs";
import { assembleBundle } from "../server/project-bundle.mjs";
import { fullstackFixture } from "./fixtures/fullstack.mjs";
test("actual fullstack builds, writes SQLite, survives restart and passes browser interactions in isolated namespace", async () => {
  assert.equal(
    (await sandboxAvailable()).available,
    true,
    "This opt-in suite requires a real working sandbox",
  );
  const report = await validateProject(
    await assembleBundle(fullstackFixture()),
  );
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.ok(report.checks.some((c) => c.name.includes("重启") && c.passed));
  assert.ok(report.screenshot);
  await fs.mkdir("artifacts", { recursive: true });
  await fs.writeFile(
    "artifacts/v32-built-preview.png",
    Buffer.from(report.screenshot, "base64"),
  );
  await fs.writeFile(
    "artifacts/v32-real-verification.json",
    JSON.stringify({ ...report, screenshot: undefined }, null, 2),
  );
});
test("actual sandbox blocks host files/environment/network and detects a broken build", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-host-secret-"));
  await fs.writeFile(path.join(dir, "secret"), "never expose");
  let contacted = false;
  const server = http
    .createServer((_req, res) => {
      contacted = true;
      res.end("host");
    })
    .listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const fixture = fullstackFixture();
  fixture.files.find((f) => f.path === "server/app.mjs").content =
    `import fs from 'node:fs';import assert from 'node:assert/strict';assert.equal(fs.existsSync(${JSON.stringify(dir + "/secret")}),false);assert.equal(fs.existsSync(${JSON.stringify(path.resolve(".local"))}),false);await assert.rejects(fetch('http://127.0.0.1:${server.address().port}',{signal:AbortSignal.timeout(500)}));\n` +
    fixture.files.find((f) => f.path === "server/app.mjs").content;
  const isolated = await validateProject(await assembleBundle(fixture));
  assert.equal(isolated.passed, true, JSON.stringify(isolated));
  assert.equal(contacted, false);
  const extra = fullstackFixture();
  extra.files[0].content =
    "import {z} from 'zod'; console.log(z);" + extra.files[0].content;
  const undeclared = await validateProject(await assembleBundle(extra));
  assert.equal(
    undeclared.passed,
    false,
    "workbench-only dependency must not pass delivered app verification",
  );
  assert.match(undeclared.logs, /zod/);
  fixture.files[0].content = "this is not valid JSX !!";
  const broken = await validateProject(await assembleBundle(fixture));
  assert.equal(broken.passed, false);
  assert.equal(broken.checks[0].name, "生产构建");
  assert.equal(broken.checks[0].passed, false);
});
test("actual cancellation kills the sandbox service tree", async () => {
  const fixture = fullstackFixture();
  fixture.files.find((f) => f.path === "server/app.mjs").content =
    "while(true){}";
  const c = new AbortController();
  const p = validateProject(await assembleBundle(fixture), {
    signal: c.signal,
  });
  const timer = setTimeout(() => c.abort(), 2000);
  try {
    await assert.rejects(p, /abort/i);
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
      "ark-verify-*.service",
    ],
    {
      encoding: "utf8",
      env: {
        PATH: "/usr/bin:/bin",
        HOME: os.homedir(),
        XDG_RUNTIME_DIR:
          process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`,
        DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || "",
      },
    },
  );
  assert.equal(units.trim(), "");
});

test("sandbox application cannot rewrite source, tests or trusted scripts", async () => {
  const fixture = fullstackFixture();
  const app = fixture.files.find((f) => f.path === "server/app.mjs");
  app.content =
    `import fs from 'node:fs';import assert from 'node:assert/strict';for(const name of ['scripts/verify.mjs','scripts/persistence.mjs','tests/acceptance.json','src/main.jsx','server/start.mjs']){assert.throws(()=>fs.writeFileSync(name,'tampered'),/read-only|EROFS|EACCES/);assert.throws(()=>fs.unlinkSync(name),/read-only|EROFS|EACCES/);}assert.throws(()=>fs.renameSync('src','src-hidden'),/read-only|EROFS|EACCES/);\n` +
    app.content;
  const report = await validateProject(await assembleBundle(fixture));
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.ok(
    report.checks.some((c) => c.name === "静态资源与请求错误状态" && c.passed),
  );
  assert.ok(report.checks.every((c) => typeof c.durationMs === "number"));
});

test("dynamic verifier rejects static samples and empty SQLite even when legacy checks pass", async () => {
  const b = fullstackFixture();
  b.files.find((f) => f.path === "server/app.mjs").content =
    `import{Router}from'express';import{DatabaseSync}from'node:sqlite';import path from'node:path';const db=new DatabaseSync(path.join(process.env.DATA_DIR,'notes.sqlite'));db.exec('CREATE TABLE notes(id INTEGER PRIMARY KEY,title TEXT)');const api=Router();api.get('/notes',(_,res)=>res.json([{id:1,title:'接口测试笔记'},{id:2,title:'浏览器创建的笔记'}]));api.post('/notes',(req,res)=>res.status(201).json({id:3,title:req.body.title}));export default api;`;
  const r = await validateProject(await assembleBundle(b));
  assert.equal(r.passed, false);
  assert.ok(r.checks.some((c) => c.name === "接口：读取笔记" && c.passed));
  assert.ok(r.checks.some((c) => c.name === "随机数据创建与读取" && !c.passed));
});
test("dynamic verifier rejects memory-only writes rather than accepting an empty database header", async () => {
  const b = fullstackFixture();
  b.files.find((f) => f.path === "server/app.mjs").content =
    `import{Router}from'express';import{DatabaseSync}from'node:sqlite';import path from'node:path';const db=new DatabaseSync(path.join(process.env.DATA_DIR,'notes.sqlite'));db.exec('CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY,title TEXT)');const rows=[];const api=Router();api.get('/notes',(_,res)=>res.json(rows));api.post('/notes',(req,res)=>{const row={id:rows.length+1,title:req.body.title};rows.push(row);res.status(201).json(row)});export default api;`;
  const r = await validateProject(await assembleBundle(b));
  assert.equal(r.passed, false);
  assert.ok(r.checks.some((c) => c.name === "随机数据创建与读取" && c.passed));
  assert.ok(r.checks.some((c) => c.name.includes("SQLite 随机") && !c.passed));
});
for (const [label, statement, checkName] of [
  [
    "ignored update",
    "db.prepare('UPDATE notes SET title=? WHERE id=?').run(req.body.title.trim(),req.params.id);",
    "随机数据更新与重启读回",
  ],
  [
    "ignored deletion",
    "db.prepare('DELETE FROM notes WHERE id=?').run(req.params.id);",
    "随机数据删除与重启确认",
  ],
])
  test(`dynamic verifier detects ${label} despite successful response codes`, async () => {
    const b = fullstackFixture(),
      app = b.files.find((f) => f.path === "server/app.mjs");
    assert.ok(app.content.includes(statement));
    app.content = app.content.replace(statement, "");
    const r = await validateProject(await assembleBundle(b));
    assert.equal(r.passed, false);
    assert.ok(r.checks.some((c) => c.name === checkName && !c.passed));
  });
test("fresh browser context catches a frontend that displays only localStorage despite successful backend writes", async () => {
  const b = fullstackFixture();
  b.files.find((f) => f.path === "src/main.jsx").content =
    `import React,{useState}from'react';import{createRoot}from'react-dom/client';import './styles.css';function App(){const[items,setItems]=useState(JSON.parse(localStorage.getItem('fake')||'[]')),[title,setTitle]=useState('');return <main><h1>我的笔记</h1><form onSubmit={async e=>{e.preventDefault();await fetch('/api/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})});const next=[...items,title];setItems(next);localStorage.setItem('fake',JSON.stringify(next));}}><input value={title} onChange={e=>setTitle(e.target.value)}/><button>新增</button></form>{items.map((v,i)=><p key={i}>{v}</p>)}</main>}createRoot(document.getElementById('root')).render(<App/>);`;
  const r = await validateProject(await assembleBundle(b));
  assert.equal(r.passed, false);
  assert.ok(
    r.checks.some((c) => c.name === "浏览器启动与前后端交互" && c.passed),
  );
  assert.ok(r.checks.some((c) => c.name.includes("无缓存读回") && !c.passed));
});
test("undeclared update/delete remain explicitly uncovered; old fixed-only contracts cannot gain new verification", async () => {
  const b = fullstackFixture();
  delete b.tests.persistence.update;
  delete b.tests.persistence.remove;
  const r = await validateProject(await assembleBundle(b));
  assert.equal(r.passed, true, JSON.stringify(r));
  assert.equal(r.verificationVersion, 2);
  assert.equal(r.coverage.update, false);
  assert.equal(r.coverage.remove, false);
  assert.match(r.scope, /未声明，未覆盖/);
  delete b.tests.persistence;
  const old = await validateProject(await assembleBundle(b));
  assert.equal(old.passed, false);
  assert.ok(old.checks.some((c) => c.name === "动态验收契约" && !c.passed));
});
