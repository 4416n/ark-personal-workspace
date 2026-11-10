import { test } from "node:test";
import assert from "node:assert/strict";
import { completeLongForm } from "../server/long-form.mjs";

test("截断后继续写，直到模型结束", async () => {
  const reasons = ["length", "stop"];
  const pieces = ["# 标题\n\n第一段", "\n第二段"];
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

test("续写保留代码/单词中断处的原始空白，不擅自插入换行", async () => {
  let reason = "length";
  const pieces = ['const message = "hel', 'lo";\n  next();'];
  const result = await completeLongForm(
    async () => {
      const piece = pieces.shift();
      reason = pieces.length ? "length" : "stop";
      return piece;
    },
    [],
    { finishReason: () => reason },
  );
  assert.equal(result, 'const message = "hello";\n  next();');
});

test("无正文结束标记、空白、重复以及异常结束不冒充完整交付", async () => {
  for (const piece of ["[完]", "  ", "部分输出"]) {
    await assert.rejects(
      completeLongForm(async () => piece, [], {
        finishReason: () => (piece === "部分输出" ? "content_filter" : "stop"),
      }),
    );
  }
  let reason = "length",
    calls = 0;
  await assert.rejects(
    completeLongForm(
      async () => {
        reason = ++calls === 1 ? "length" : "stop";
        return "重复正文";
      },
      [],
      { finishReason: () => reason },
    ),
    /未提供有效续写/,
  );
  assert.equal(calls, 2);
});

test("取消之后不发起续写；超出大小或次数上限不返回正文", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    completeLongForm(
      async () => {
        calls++;
        controller.abort();
        return "草稿";
      },
      [],
      {
        finishReason: () => "length",
        completion: { req: { runSignal: controller.signal } },
      },
    ),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    completeLongForm(async () => "太长", [], { maxChars: 1 }),
    /大小上限/,
  );
  await assert.rejects(
    completeLongForm(async () => "test", [], { parts: 5 }),
    /上限/,
  );
});
