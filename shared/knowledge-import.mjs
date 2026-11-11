export const IMPORT_LIMITS = Object.freeze({ files: 20, fileBytes: 200000, totalBytes: 2000000, characters: 100000 });
const sameScope = (note, projectId) => (note.projectId || "") === projectId;
const key = (name) => name.normalize("NFKC").toLocaleLowerCase();
const textKey = (text) => text.replace(/\r\n?/g, "\n");

export async function readKnowledgeFiles(files) {
  if (!files.length || files.length > IMPORT_LIMITS.files) throw new Error("一次请选择 1–20 个 TXT 或 Markdown 文件。");
  if (files.reduce((sum, file) => sum + file.size, 0) > IMPORT_LIMITS.totalBytes) throw new Error("本批文件合计超过 2 MB，请分批导入。");
  const results = [];
  const names = new Set();
  for (const [index, file] of files.entries()) {
    const row = { id: String(index), name: file.name, bytes: file.size, title: file.name.replace(/\.[^.]+$/, "").slice(0, 200), content: "", modifiedAt: "", error: "" };
    try {
      if (!/\.(md|markdown|txt)$/i.test(file.name)) throw new Error("仅支持 TXT / Markdown；PDF、Word 请先转为 UTF-8 文本。");
      if (file.name.length > 255 || !row.title.trim()) throw new Error("文件名为空或超过 255 字符，请先重命名。");
      if (file.size > IMPORT_LIMITS.fileBytes) throw new Error("超过单文件 200 KB 上限，请拆分。");
      if (names.has(key(file.name))) throw new Error("本批有同名文件，请分别导入以明确处理版本。");
      names.add(key(file.name));
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength > IMPORT_LIMITS.fileBytes) throw new Error("实际内容超过单文件 200 KB 上限。");
      try { row.content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new Error("不是有效的 UTF-8 文本，请在编辑器中另存为 UTF-8 后重试。"); }
      if (row.content.includes("\0")) throw new Error("包含二进制或空字符，无法作为文本资料导入。");
      if (!row.content.trim()) throw new Error("文件内容为空。");
      if (row.content.length > IMPORT_LIMITS.characters) throw new Error("正文超过 10 万字符，请拆分后导入。");
      row.modifiedAt = new Date(file.lastModified).toISOString();
    } catch (error) { row.error = error.message || "文件读取失败，请重新选择。"; }
    results.push(row);
  }
  return results;
}

export function previewKnowledgeImport(files, knowledge, projectId = "") {
  const scoped = knowledge.filter((note) => sameScope(note, projectId));
  const seen = new Set();
  const titles = new Set();
  return files.map((file) => {
    if (file.error) return { ...file, status: "invalid", message: file.error, matches: [], target: null };
    const text = textKey(file.content);
    if (seen.has(text)) return { ...file, status: "duplicate", message: "与本批前面的文件正文相同，将跳过。", matches: [], target: null };
    seen.add(text);
    if (titles.has(key(file.title))) return { ...file, status: "invalid", message: "本批有同标题的其他文件，请重命名或分别导入。", matches: [], target: null };
    titles.add(key(file.title));
    const identical = scoped.find((note) => textKey(note.content) === text);
    if (identical) return { ...file, status: "duplicate", message: `与「${identical.title}」正文相同，将跳过。`, matches: [identical.id], target: null };
    const matches = scoped.filter((note) => key(note.title) === key(file.title) || (note.sourceFile && key(note.sourceFile.name) === key(file.name)));
    const target = matches.length === 1 && !matches[0].sourceTaskId ? matches[0] : null;
    return { ...file, status: matches.length ? "conflict" : "new", message: matches.length ? (target ? `已存在「${target.title}」，默认保留现有资料。` : "同名资料不唯一或来自任务成果，可另存副本。") : "新资料，确认后加入知识空间。", matches: matches.map((note) => note.id), target: target ? structuredClone(target) : null };
  });
}

export function applyKnowledgeImport(knowledge, preview, choices, { projectId = "", importedAt, createId }) {
  let next = [...knowledge];
  let added = 0, replaced = 0, skipped = 0;
  for (const row of preview) {
    const action = choices[row.id] || (row.status === "new" ? "add" : "skip");
    if (action === "skip" || ["invalid", "duplicate"].includes(row.status)) { skipped++; continue; }
    const current = previewKnowledgeImport([row], next, projectId)[0];
    if (current.status === "duplicate") throw new Error(`「${row.name}」已有相同正文，请重新核对预览。`);
    if (action === "add" && current.status !== "new") throw new Error(`「${row.name}」出现新的同名资料，请重新核对预览。`);
    if (action === "replace") {
      const target = row.target && next.find((note) => note.id === row.target.id);
      if (!target || target.sourceTaskId || JSON.stringify(target) !== JSON.stringify(row.target) || current.matches.length !== 1 || current.matches[0] !== target.id) throw new Error(`「${row.name}」的原资料已变化，未覆盖任何内容，请重新核对预览。`);
    } else if (action !== "add" && action !== "copy") throw new Error("导入操作无效，请重新预览。");
    const previous = action === "replace" ? row.target : null;
    const note = {
      ...(previous || {}),
      id: previous?.id || createId(),
      title: previous?.title || (action === "copy" ? `${row.title.slice(0, 190)}（导入副本）` : row.title),
      content: row.content,
      category: previous?.category || "资料",
      updatedAt: importedAt,
      ...(projectId ? { projectId } : {}),
      sourceFile: { name: row.name, modifiedAt: row.modifiedAt, importedAt },
    };
    next = [note, ...next.filter((item) => item.id !== note.id)];
    if (previous) replaced++; else added++;
  }
  if (next.length > 2000) throw new Error("知识资料将超过 2000 篇上限，请先整理现有资料。");
  return { knowledge: next, added, replaced, skipped };
}
