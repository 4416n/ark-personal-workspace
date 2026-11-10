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
const concepts = [
  ["知识库", "资料库", "文档", "笔记", "条目", "检索", "归档"],
  ["分类", "目录", "主题", "结构"],
  ["验收", "审查", "标准", "交付"],
  ["流程", "步骤", "规范"],
];
function queryTerms(query) {
  const base = [...new Set(tokens(query))];
  const raw = String(query || "").toLowerCase();
  const extra = [];
  for (const group of concepts)
    if (group.some((word) => raw.includes(word)))
      for (const word of group)
        if (!raw.includes(word) && !base.includes(word)) extra.push(word);
  return [...base.map((term) => [term, 1]), ...extra.map((term) => [term, 0.45])].slice(
    0,
    100,
  );
}
function bigrams(text) {
  const grams = new Set();
  for (const run of String(text || "").toLowerCase().match(/[\u3400-\u9fff]+/g) || [])
    for (let i = 0; i < run.length - 1; i += 1) grams.add(run.slice(i, i + 2));
  return grams;
}
function overlap(left, right) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}
export function retrieve(knowledge, query, projectId = "", limit = 6) {
  const q = queryTerms(query);
  if (!q.length) return [];
  const queryGrams = bigrams(query);
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
        overlap: overlap(queryGrams, bigrams(`${note.title} ${content}`)),
      });
    }
  }
  const avg =
    chunks.reduce((n, c) => n + c.length, 0) / (chunks.length || 1) || 1;
  const df = new Map(
    q.map(([term]) => [term, chunks.filter((c) => c.counts.has(term)).length]),
  );
  const ranked = chunks
    .map((c) => {
      let score = 0;
      for (const [term, weight] of q) {
        const tf = c.counts.get(term) || 0;
        if (tf)
          score +=
            (Math.log(
              1 + (chunks.length - df.get(term) + 0.5) / (df.get(term) + 0.5),
            ) *
              tf *
              2.2) /
            (tf + 1.2 * (0.25 + (0.75 * c.length) / avg)) *
            weight;
      }
      if (c.overlap >= 0.18) score += c.overlap * 3;
      const { counts, length, overlap: _overlap, ...passage } = c;
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
