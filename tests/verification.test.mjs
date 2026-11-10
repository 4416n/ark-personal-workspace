import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseBundle } from "../server/project-bundle.mjs";
import { fullstackFixture } from "./fixtures/fullstack.mjs";
import {
  assertDynamicTests,
  substitute,
  sqliteContains,
} from "../server/scaffold/scripts/persistence.mjs";

test("dynamic contract rejects missing runtime bindings, unsafe paths, wrong lifecycle methods and ID mappings", () => {
  const good = fullstackFixture();
  assert.doesNotThrow(() =>
    parseBundle(JSON.stringify(good), { requirePersistence: true }),
  );
  for (const change of [
    (b) => delete b.tests.persistence,
    (b) => (b.tests.persistence.create.body = { title: "fixed sample" }),
    (b) => (b.tests.persistence.update.body = { title: "fixed update" }),
    (b) => (b.tests.persistence.create.path = "https://example.com/api/notes"),
    (b) => (b.tests.persistence.read.path = "/api/%2e%2e/secret"),
    (b) => (b.tests.persistence.read.path = "/api/{{id}}"),
    (b) => (b.tests.persistence.read.body = { title: "x" }),
    (b) => (b.tests.persistence.create.method = "GET"),
    (b) => (b.tests.persistence.remove.path = "/api/notes/fixed-id"),
    (b) => (b.tests.persistence.idPointer = "/../id"),
    (b) => (b.tests.persistence.storage.table = "notes;DROP TABLE notes"),
    (b) =>
      (b.tests.persistence.create.body = { title: "{{unknown}} {{value}}" }),
    (b) => (b.tests.browser[0].value = "fixed browser value"),
    (b) => (b.tests.browser[2].value = "fixed assertion"),
  ]) {
    const b = structuredClone(good);
    change(b);
    assert.throws(() =>
      parseBundle(JSON.stringify(b), { requirePersistence: true }),
    );
  }
  const old = structuredClone(good);
  delete old.tests.persistence;
  assert.doesNotThrow(
    () => parseBundle(JSON.stringify(old)),
    "legacy source remains importable, not newly verified",
  );
  assert.throws(() => assertDynamicTests(old.tests), /旧版/);
  const appendOnly = structuredClone(good);
  delete appendOnly.tests.persistence.update;
  delete appendOnly.tests.persistence.remove;
  delete appendOnly.tests.persistence.idPointer;
  assert.doesNotThrow(() => assertDynamicTests(appendOnly.tests));
});
test("runtime substitution binds only known values without executing JSON content", () => {
  assert.deepEqual(
    substitute(
      { title: "prefix {{value}}", nested: ["{{id}}"] },
      { value: 'a"\\b', id: "22" },
    ),
    { title: 'prefix a"\\b', nested: ["22"] },
  );
  assert.throws(() => substitute("{{unknown}}", { value: "a" }));
  const injected = JSON.parse('{"__proto__":{"x":"{{value}}"}}');
  assert.equal(
    Object.hasOwn(substitute(injected, { value: "safe" }), "__proto__"),
    true,
  );
  assert.equal({}.x, undefined);
});
test("SQLite evidence inspects declared business fields, not empty headers or unrelated audit history", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ark-sql-evidence-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const db = new DatabaseSync(path.join(dir, "test.sqlite"));
  db.exec(
    "CREATE TABLE notes(id INTEGER PRIMARY KEY,title TEXT); CREATE TABLE audit(message TEXT)",
  );
  db.prepare("INSERT INTO audit VALUES(?)").run("old-random-token");
  db.close();
  const storage = { table: "notes", column: "title" };
  assert.equal(
    (await sqliteContains(dir, ["old-random-token"], storage)).size,
    0,
  );
  const writer = new DatabaseSync(path.join(dir, "test.sqlite"));
  writer.prepare("INSERT INTO notes(title) VALUES(?)").run("new-random-token");
  writer.close();
  assert.deepEqual(
    [
      ...(await sqliteContains(
        dir,
        ["old-random-token", "new-random-token"],
        storage,
      )),
    ],
    ["new-random-token"],
  );
  await fs.symlink(
    path.join(dir, "test.sqlite"),
    path.join(dir, "link.sqlite"),
  );
  await assert.rejects(
    sqliteContains(dir, ["new-random-token"], storage),
    /符号链接/,
  );
});

test("ID pointer validation rejects a long malformed path without ambiguous regex repetition", () => {
  const b = fullstackFixture();
  b.tests.persistence.idPointer = "/" + "a".repeat(115) + "!";
  assert.throws(() => assertDynamicTests(b.tests), /idPointer/);
});
