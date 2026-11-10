// Keep calling the model until it finishes, instead of discarding a cut-off draft.
export async function completeLongForm(completion, messages, options = {}) {
  const parts = options.parts ?? 4;
  const maxChars = options.maxChars ?? 100000;
  let content = "";
  let truncated = false;
  for (let part = 1; part <= parts; part += 1) {
    await options.onPart?.({ part, parts });
    const prompt =
      part === 1
        ? messages
        : [
            ...messages,
            { role: "assistant", content: content.slice(-16000) },
            {
              role: "user",
              content:
                "上文因长度限制中断。请从中断处接着写，不要重复已写内容，不要重写标题。如果已经完整，只回复[完]。",
            },
          ];
    const piece = await completion(prompt, {
      ...options.completion,
      allowPartial: true,
    });
    if (piece.trim() === "[完]") {
      truncated = false;
      break;
    }
    const addition = piece.trim();
    if (content && content.endsWith(addition)) break;
    content = content ? `${content.replace(/\s+$/, "")}\n${addition}` : addition;
    if (content.length > maxChars)
      throw new Error("模型输出超过本次交付大小上限，请缩小项目首版范围");
    truncated = options.finishReason?.() === "length";
    if (!truncated) break;
  }
  if (truncated)
    throw new Error(
      "模型输出达到长度限制，内容可能不完整；未保存为交付物，请缩小任务范围后重试",
    );
  if (!content.trim())
    throw new Error("模型返回为空，请检查模型是否支持对话接口。");
  return content;
}
