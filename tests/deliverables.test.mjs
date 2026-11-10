import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deliverableFiles,
  resultPreview,
  zipStore,
} from "../shared/deliverables.mjs";

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
    { title: "空任务", status: "done", ownerId: "a", description: "", result: "  " },
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
