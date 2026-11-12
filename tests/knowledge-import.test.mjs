import { test } from "node:test";
import assert from "node:assert/strict";
import { readKnowledgeFiles, previewKnowledgeImport, applyKnowledgeImport } from "../shared/knowledge-import.mjs";
import { knowledgeSchema, stateSchema, seedWorkspace } from "../src/domain.ts";
import { retrieve } from "../shared/retrieval.mjs";
const timestamp = "2026-11-11T08:00:00.000Z";
const file = (name, content) => new File([content], name, { lastModified: Date.parse(timestamp) });
const note = (extra = {}) => ({ id: "n1", title: "品牌指南", content: "旧文档内容", category: "资料", updatedAt: timestamp, ...extra });
const options = (projectId = "") => ({ projectId, importedAt: timestamp, createId: () => crypto.randomUUID() });

test("batch reader decodes UTF-8/BOM, rejects bad bytes and binary content without losing valid files", async () => {
  const rows = await readKnowledgeFiles([
    file("品牌指南.md", "\uFEFF# 定位\n面向独立开发者 ✨"),
    file("乱码.txt", new Uint8Array([0xc3, 0x28])),
    file("binary.txt", "a\0b"),
    file("empty.md", " \n"),
    file("wrong.pdf", "pdf"),
  ]);
  assert.equal(rows[0].error, "");
  assert.equal(rows[0].content, "# 定位\n面向独立开发者 ✨");
  assert.match(rows[1].error, /UTF-8/);
  assert.match(rows[2].error, /二进制/);
  assert.match(rows[3].error, /为空/);
  assert.match(rows[4].error, /仅支持/);
});
test("file, batch, character and ambiguous-name limits are enforced before importing", async () => {
  await assert.rejects(readKnowledgeFiles(Array.from({ length: 21 }, () => file("a.txt", "x"))), /1–20/);
  await assert.rejects(readKnowledgeFiles(Array.from({ length: 11 }, (_, i) => file(`${i}.txt`, "x".repeat(200000)))), /2 MB/);
  const rows = await readKnowledgeFiles([file("big.txt", "中".repeat(70000)), file("long.md", "x".repeat(100001)), file("same.md", "a"), file("SAME.md", "b")]);
  assert.match(rows[0].error, /200 KB/);
  assert.match(rows[1].error, /10 万/);
  assert.match(rows[3].error, /同名/);
  const conflicting = previewKnowledgeImport(await readKnowledgeFiles([file("same.md", "a"), file("same.txt", "b")]), []);
  assert.equal(conflicting[1].status, "invalid");
});
test("preview scopes duplicates, protects derived notes and preserves exact body/source metadata", async () => {
  const rows = await readKnowledgeFiles([file("品牌指南.md", "品牌定位：面向自由职业者\r\n使用案例"), file("相同正文.txt", "品牌定位：面向自由职业者\n使用案例")]);
  const notes = [note(), note({ id: "other", projectId: "p", content: rows[0].content })];
  const preview = previewKnowledgeImport(rows, notes);
  assert.equal(preview[0].status, "conflict");
  assert.equal(preview[1].status, "duplicate");
  assert.equal(previewKnowledgeImport(rows, notes, "p")[0].status, "duplicate");
  const result = applyKnowledgeImport(notes, preview, { 0: "replace" }, options());
  assert.equal(result.replaced, 1);
  assert.equal(result.knowledge[0].id, "n1");
  assert.equal(result.knowledge[0].content, rows[0].content);
  assert.deepEqual(result.knowledge[0].sourceFile, { name: "品牌指南.md", modifiedAt: timestamp, importedAt: timestamp });
  assert.equal(knowledgeSchema.parse(result.knowledge[0]).sourceFile.name, "品牌指南.md");
  assert.equal(previewKnowledgeImport(rows, [note({ sourceTaskId: "task-1" })])[0].target, null);
  assert.ok(retrieve(result.knowledge, "自由职业者品牌定位").some((passage) => passage.noteId === "n1"));
  const state = seedWorkspace();
  state.knowledge = result.knowledge;
  assert.equal(stateSchema.safeParse(state).success, true);
});
test("confirm is atomic: stale replacements or newly appeared duplicates never overwrite newer work", async () => {
  const notes = [note()];
  const rows = await readKnowledgeFiles([file("new.md", "new body"), file("品牌指南.md", "new guide")]);
  const preview = previewKnowledgeImport(rows, notes);
  const latest = [note({ content: "用户刚刚编辑" })];
  assert.throws(() => applyKnowledgeImport(latest, preview, { 1: "replace" }, options()), /原资料已变化/);
  assert.deepEqual(latest, [note({ content: "用户刚刚编辑" })]);
  assert.throws(() => applyKnowledgeImport([note({ title: "new", content: "new body" })], preview, {}, options()), /已有相同正文/);
  const result = applyKnowledgeImport(notes, preview, { 0: "skip", 1: "copy" }, options());
  assert.equal(result.knowledge[0].title, "品牌指南（导入副本）");
  assert.equal(result.knowledge[1].content, "旧文档内容");
});
test("old backups remain valid; source metadata timestamps and filenames are validated", () => {
  assert.equal(knowledgeSchema.safeParse(note()).success, true);
  assert.equal(knowledgeSchema.safeParse(note({ sourceFile: { name: "a.md", modifiedAt: "yesterday", importedAt: timestamp } })).success, false);
  assert.equal(knowledgeSchema.safeParse(note({ sourceFile: { name: "x".repeat(256), modifiedAt: timestamp, importedAt: timestamp } })).success, false);
});
