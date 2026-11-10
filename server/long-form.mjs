// Bounded continuation for text deliverables, never for structured/code bundles.
export async function completeLongForm(completion, messages, options = {}) {
  const parts = options.parts ?? 4;
  const maxChars = options.maxChars ?? 100000;
  if (!Number.isInteger(parts) || parts < 1 || parts > 4)
    throw new Error("续写调用上限必须在 1 到 4 次之间");
  let content = "";
  for (let part = 1; part <= parts; part += 1) {
    options.completion?.req?.runSignal?.throwIfAborted();
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
                "上文因长度限制中断。请从中断处接着写，不要重复已写内容，不要重写标题。保留衔接处所需的空格和换行。如果已经完整，只回复[完]。",
            },
          ];
    const piece = await completion(prompt, {
      ...options.completion,
      allowPartial: true,
    });
    options.completion?.req?.runSignal?.throwIfAborted();
    const reason = options.finishReason?.() || "";
    if (reason && !["length", "stop"].includes(reason))
      throw new Error("模型异常结束，未保存为交付物，请检查执行记录后重试");
    if (typeof piece !== "string" || !piece.trim())
      throw new Error("模型返回为空，请检查模型是否支持对话接口。");
    if (piece.trim() === "[完]" && content && reason !== "length")
      return content;
    if (
      piece.trim() === "[完]" ||
      (content && content.trimEnd().endsWith(piece.trim()))
    )
      throw new Error(
        "模型未提供有效续写，内容可能因长度限制不完整；未保存为交付物，请缩小任务范围后重试",
      );
    content += piece;
    if (content.length > maxChars)
      throw new Error("模型输出超过本次交付大小上限，请缩小项目首版范围");
    if (reason !== "length") return content;
  }
  throw new Error(
    "模型输出达到长度限制，内容可能不完整；未保存为交付物，请缩小任务范围后重试",
  );
}
