// Local lexical RAG: Chinese word/bigram + Latin token BM25 retrieval.
// No embedding service, model key or external index is required.
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
export function tokens(text) {
  const normalized = text.toLowerCase();
  const terms = [...segmenter.segment(normalized)]
    .filter((x) => x.isWordLike)
    .map((x) => x.segment);
  for (const run of normalized.match(/[\u3400-\u9fff]+/g) || [])
    for (let i = 0; i < run.length - 1; i++) terms.push(run.slice(i, i + 2));
  return terms.filter(
    (x) =>
      x.length > 1 &&
      ![
        "什么",
        "如何",
        "这个",
        "我们",
        "可以",
        "需要",
        "一个",
        "以及",
        "the",
        "and",
      ].includes(x),
  );
}
export function retrieve(knowledge, query, projectId = "", limit = 6) {
  const q = [...new Set(tokens(query))].slice(0, 100);
  if (!q.length) return [];
  const chunks = [];
  for (const note of knowledge.filter(
    (k) => !k.projectId || k.projectId === projectId,
  )) {
    for (let start = 0; start < note.content.length; start += 780) {
      const content = note.content.slice(start, start + 900);
      const terms = tokens(`${note.title} ${note.title} ${content}`);
      const counts = new Map();
      for (const t of terms) counts.set(t, (counts.get(t) || 0) + 1);
      chunks.push({
        noteId: note.id,
        title: note.title,
        projectId: note.projectId,
        content,
        start,
        end: start + content.length,
        counts,
        length: terms.length,
      });
    }
  }
  const avg =
    chunks.reduce((n, c) => n + c.length, 0) / (chunks.length || 1) || 1;
  const df = new Map(
    q.map((t) => [t, chunks.filter((c) => c.counts.has(t)).length]),
  );
  const ranked = chunks
    .map((c) => {
      let score = 0;
      for (const t of q) {
        const tf = c.counts.get(t) || 0;
        if (tf)
          score +=
            (Math.log(
              1 + (chunks.length - df.get(t) + 0.5) / (df.get(t) + 0.5),
            ) *
              tf *
              2.2) /
            (tf + 1.2 * (0.25 + (0.75 * c.length) / avg));
      }
      const { counts, length, ...passage } = c;
      return { ...passage, score: Math.round(score * 100) / 100 };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  const perNote = new Map();
  return ranked
    .filter((c) => {
      const count = perNote.get(c.noteId || c.title) || 0;
      perNote.set(c.noteId || c.title, count + 1);
      return count < 2;
    })
    .slice(0, limit)
    .map((c, i) => ({ ...c, citation: `资料${i + 1}` }));
}
export function retrievalContext(passages) {
  return passages.length
    ? passages
        .map(
          (p) =>
            `[${p.citation}] ${p.title}（字符 ${p.start + 1}–${p.end}）\n${p.content}`,
        )
        .join("\n\n") +
        "\n使用参考资料时标注对应的[资料N]。没有资料支持的结论请说明是建议或假设，不要编造引用。"
    : "未检索到相关资料。不得虚构资料引用；需要事实依据时说明资料不足。";
}
