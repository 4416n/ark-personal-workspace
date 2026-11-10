// Trusted lifecycle checks. Only data (never scripts or SQL) comes from the model.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
export const VERIFICATION_VERSION = 2;
const has = (data, marker) =>
  typeof data === "string"
    ? data.includes(marker)
    : data &&
      typeof data === "object" &&
      Object.values(data).some((v) => has(v, marker));
export function substitute(data, values) {
  if (typeof data === "string")
    return data.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      assert.ok(Object.hasOwn(values, key), `未知测试变量：${key}`);
      return values[key];
    });
  if (Array.isArray(data)) return data.map((v) => substitute(v, values));
  if (data && typeof data === "object")
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, substitute(v, values)]),
    );
  return data;
}
const validPath = (p, withId = false) => {
  assert.equal(typeof p, "string", "缺少持久化 API 路径");
  assert.ok(
    p.length <= 200 && /^\/api\/[A-Za-z0-9_/?=&%.{}+-]+$/.test(p),
    "非法持久化 API 路径",
  );
  const rendered = substitute(p, withId ? { id: "test-id" } : {});
  assert.ok(!/[{}]/.test(rendered), "路径包含未解析的测试变量");
  assert.ok(!decodeURIComponent(rendered).includes(".."), "路径不能越界");
  assert.ok(
    new URL(rendered, "http://sandbox.local").pathname.startsWith("/api/"),
    "路径必须位于 /api/",
  );
};
export function assertDynamicTests(tests) {
  const p = tests?.persistence;
  assert.ok(
    p,
    "缺少 tests.persistence 动态持久化契约；旧版固定样例不能升级为新验收通过，请生成新版本补齐契约",
  );
  assert.ok(
    p.storage &&
      [p.storage.table, p.storage.column].every(
        (v) => typeof v === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(v),
      ),
    "storage 必须指定保存随机值的业务表 table 和字段 column",
  );
  for (const [kind, methods] of [
    ["create", ["POST"]],
    ["read", ["GET"]],
    ["update", ["PATCH", "PUT"]],
    ["remove", ["DELETE"]],
  ]) {
    const item = p[kind];
    if (!item && ["update", "remove"].includes(kind)) continue;
    assert.ok(item && methods.includes(item.method), `持久化 ${kind} 方法无效`);
    assert.ok(
      Number.isInteger(item.status) && item.status >= 200 && item.status < 300,
      "持久化操作必须声明 2xx 状态",
    );
    validPath(item.path, ["update", "remove"].includes(kind));
    if (["update", "remove"].includes(kind))
      assert.ok(
        item.path.includes("{{id}}"),
        "更新/删除路径必须绑定创建记录的 {{id}}",
      );
    if (["create", "update"].includes(kind)) {
      assert.ok(
        has(item.body, "{{value}}"),
        "创建/更新正文必须绑定运行时 {{value}}",
      );
      substitute(item.body, { value: "check" });
    } else assert.equal(item.body, undefined, "读取/删除契约不支持请求正文");
  }
  if (p.update || p.remove)
    assert.ok(
      typeof p.idPointer === "string" &&
        /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(p.idPointer) &&
        p.idPointer.length <= 120,
      "更新/删除需要创建响应中的 idPointer（如 /id）",
    );
  assert.ok(
    tests.browser?.some(
      (s) => s.action === "fill" && has(s.value, "{{browserValue}}"),
    ),
    "浏览器必须填写运行时 {{browserValue}}",
  );
  assert.ok(
    tests.browser?.some(
      (s) => s.action === "text" && has(s.value, "{{browserValue}}"),
    ),
    "浏览器必须断言运行时 {{browserValue}}",
  );
  for (const step of tests.browser || [])
    if (step.value !== undefined)
      substitute(step.value, { browserValue: "check" });
}
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';

// Inspect real table values after the app has stopped. A header/empty DB is not evidence.
export async function sqliteContains(directory, values, storage) {
  const found = new Set();
  let files = 0,
    databases = 0,
    directories = 0;
  async function visit(dir, depth) {
    assert.ok(depth < 8 && ++directories <= 128, "数据目录超过检查范围");
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const name = path.join(dir, entry.name);
      assert.ok(!entry.isSymbolicLink(), "验收数据目录不能包含符号链接");
      if (entry.isDirectory()) {
        await visit(name, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      assert.ok(++files <= 256, "数据文件过多，无法可靠验收");
      const handle = await fs.open(name, "r");
      const header = Buffer.alloc(16);
      try {
        await handle.read(header, 0, 16, 0);
      } finally {
        await handle.close();
      }
      if (header.toString() !== "SQLite format 3\0") continue;
      assert.ok(++databases <= 16, "数据库过多，无法可靠验收");
      const db = new DatabaseSync(name, { readOnly: true });
      try {
        db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;");
        const tables = db
          .prepare(
            "SELECT name, sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )
          .all();
        assert.ok(tables.length <= 100, "数据库表过多，无法可靠验收");
        for (const table of tables) {
          if (storage && table.name !== storage.table) continue;
          if (/CREATE\s+VIRTUAL\s+TABLE/i.test(table.sql || "")) continue;
          const columns = db
            .prepare(`PRAGMA table_info(${quote(table.name)})`)
            .all()
            .filter((c) => !storage || c.name === storage.column);
          assert.ok(columns.length <= 100, "数据库列过多，无法可靠验收");
          if (!columns.length) continue;
          for (const value of values) {
            const terms = columns.map(
              (c) =>
                `(typeof(${quote(c.name)})='text' AND instr(${quote(c.name)}, ?) > 0)`,
            );
            if (
              db
                .prepare(
                  `SELECT 1 AS present FROM ${quote(table.name)} WHERE ${terms.join(" OR ")} LIMIT 1`,
                )
                .get(...columns.map(() => value))
            )
              found.add(value);
          }
        }
      } finally {
        db.close();
      }
    }
  }
  await visit(directory, 0);
  return found;
}

export async function verifyPersistence({
  tests,
  base,
  stop,
  start,
  data,
  check,
}) {
  const p = tests.persistence;
  const original = `ark_${randomUUID().replaceAll("-", "")}`;
  const updated = `ark_${randomUUID().replaceAll("-", "")}`;
  let recordId = "";
  const request = async (item, value = original) => {
    const pathname = substitute(item.path, {
      id: encodeURIComponent(recordId),
    });
    validPath(pathname);
    const response = await fetch(base + pathname, {
      method: item.method,
      headers: { "content-type": "application/json" },
      body:
        item.body === undefined
          ? undefined
          : JSON.stringify(substitute(item.body, { value })),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    assert.equal(
      response.status,
      item.status,
      `持久化 ${item.method} ${pathname} 状态不匹配`,
    );
    const text = await response.text();
    assert.ok(text.length <= 1000000, "验收响应过大");
    return text;
  };
  const read = async (present, absent = []) => {
    const text = await request(p.read);
    for (const value of present)
      assert.ok(text.includes(value), "读取接口未返回本次随机写入的数据");
    for (const value of absent)
      assert.ok(!text.includes(value), "读取接口仍返回不应存在的数据");
  };
  const restartEvidence = async (present, absent = []) => {
    await stop();
    const stored = await sqliteContains(
      data,
      [...present, ...absent],
      p.storage,
    );
    for (const value of present)
      assert.ok(
        stored.has(value),
        "SQLite 业务表未实际保存本次随机数据（空库或文件头不算持久化）",
      );
    for (const value of absent)
      assert.ok(
        !stored.has(value),
        "SQLite 中仍保留已替换或删除的随机数据；不可当作更新/硬删除通过",
      );
    await start();
    await read(present, absent);
  };
  await check("随机数据创建与读取", async () => {
    await read([], [original]);
    const created = await request(p.create);
    if (p.update || p.remove) {
      let value = JSON.parse(created);
      for (const key of p.idPointer.slice(1).split("/")) {
        assert.ok(
          value && Object.hasOwn(value, key),
          "创建响应缺少 idPointer 指定的 ID",
        );
        value = value[key];
      }
      assert.ok(
        (typeof value === "number" && Number.isSafeInteger(value)) ||
          (typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value)),
        "创建 ID 格式不支持",
      );
      recordId = String(value);
    }
    await read([original]);
  });
  await check("SQLite 随机数据落库与重启读回", () =>
    restartEvidence([original]),
  );
  if (p.update) {
    await check("随机数据更新与重启读回", async () => {
      await request(p.update, updated);
      await read([updated], [original]);
      await restartEvidence([updated], [original]);
    });
  }
  if (p.remove) {
    await check("随机数据删除与重启确认", async () => {
      await request(p.remove);
      await read([], [original, updated]);
      await restartEvidence([], [original, updated]);
    });
  }
  return {
    create: true,
    read: true,
    restart: true,
    update: !!p.update,
    remove: !!p.remove,
  };
}
