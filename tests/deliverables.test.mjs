import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deliverableFiles,
  resultPreview,
  zipStore,
} from "../shared/deliverables.mjs";
import { readVerifiedZip } from "./helpers/zip.mjs";

test("成果预览去掉标记并截断", () => {
  assert.equal(resultPreview("# 标题\n\n正文 **要点**"), "标题 正文 要点");
  assert.equal(resultPreview("一二三四五", 3), "一二三…");
  assert.equal(resultPreview("   "), "");
});

test("成果包包含总文档和各任务正文，ZIP 可按文件名读回", () => {
  const project = {
    title: "公司知识库",
    goal: "整理资料",
    successCriteria: "可检索",
    status: "active",
  };
  const tasks = [
    {
      title: "需求规范",
      status: "done",
      ownerId: "a",
      description: "交付物：规范",
      result: "# 规范\n\n第一条",
      resultMeta: { id: "v", number: 1 },
    },
    {
      title: "空任务",
      status: "done",
      ownerId: "a",
      description: "",
      result: "  ",
    },
  ];
  const files = deliverableFiles(project, tasks, [{ id: "a", name: "小策" }]);
  assert.deepEqual(
    files.map((file) => file.name),
    ["00-总文档.md", "01-需求规范.md"],
  );
  assert.match(files[1].content, /负责人：小策/);
  assert.match(files[0].content, /第一条/);
  const zip = zipStore(files);
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
  const text = new TextDecoder().decode(zip);
  assert.match(text, /00-总文档\.md/);
  assert.match(text, /01-需求规范\.md/);
  assert.match(text, /第一条/);
});

test("独立 ZIP 读取器校验 CRC、中文文件名与逐个正文，草稿明确标注", async () => {
  const files = deliverableFiles({ title: "目录", goal: "测试" }, [
    {
      title: "中文/正文",
      result: "原样正文\n\n✨",
      ownerId: "",
      status: "review",
      description: "任务",
    },
  ]);
  assert.match(files[1].content, /未验收草稿/);
  const zip = Buffer.from(zipStore(files));
  const restored = await readVerifiedZip(zip);
  assert.deepEqual([...restored.keys()], files.map((file) => file.name));
  for (const file of files)
    assert.equal(restored.get(file.name), file.content);
  const corrupted = Buffer.from(zip);
  const payload = corrupted.indexOf(Buffer.from("原样正文"));
  assert.ok(payload >= 0);
  corrupted[payload] ^= 1;
  await assert.rejects(readVerifiedZip(corrupted), /CRC32/);
});
