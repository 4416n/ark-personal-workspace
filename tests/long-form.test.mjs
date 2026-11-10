import { test } from "node:test";
import assert from "node:assert/strict";
import { completeLongForm } from "../server/long-form.mjs";

test("截断后继续写，直到模型结束", async () => {
  const reasons = ["length", "stop"];
  const pieces = ["# 标题\n\n第一段", "第二段"];
  let reason = "";
  const seen = [];
  const content = await completeLongForm(
    async (messages) => {
      seen.push(messages.at(-1).content);
      reason = reasons.shift();
      return pieces.shift();
    },
    [{ role: "user", content: "写完整文档" }],
    { finishReason: () => reason, onPart: () => {} },
  );
  assert.equal(content, "# 标题\n\n第一段\n第二段");
  assert.match(seen[1], /从中断处接着写/);
});

test("分段用尽仍然截断时不返回半成品", async () => {
  await assert.rejects(
    completeLongForm(
      async () => "部分输出",
      [{ role: "user", content: "写" }],
      { parts: 2, finishReason: () => "length" },
    ),
    /长度限制/,
  );
});
