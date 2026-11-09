import { useState } from "react";
import { Search, FileSearch } from "lucide-react";
import { useApp } from "./context";
import { api } from "./store";
import { Sources } from "./runs-ui";
import type { Passage } from "../shared/retrieval.mjs";
export function KnowledgeRetrieval() {
  const { state } = useApp();
  const [projectId, setProjectId] = useState("");
  const [query, setQuery] = useState("");
  const [passages, setPassages] = useState<Passage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="panel retrieval-panel">
      <header>
        <FileSearch size={21} />
        <div>
          <h2>先找资料，再交给 AI</h2>
          <p>在本地按关键词相关度提取片段，无需额外模型费用。</p>
        </div>
      </header>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const r = await api<{ passages: Passage[] }>("/retrieve", {
              knowledge: state.knowledge,
              query,
              projectId,
            });
            setPassages(r.passages);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          资料范围
          <select
            aria-label="检索项目范围"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setPassages(null);
            }}
          >
            <option value="">公共知识</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} + 公共知识
              </option>
            ))}
          </select>
        </label>
        <label className="field retrieval-query">
          你要找什么
          <input
            required
            maxLength={10000}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例如：个人品牌的目标读者和写作风格"
          />
        </label>
        <button className="button primary" disabled={busy}>
          <Search size={16} />
          {busy ? "检索中…" : "检索资料"}
        </button>
      </form>
      {error && <p className="alert error">{error}</p>}
      {passages && (
        <>
          {passages.length ? (
            <Sources passages={passages} />
          ) : (
            <p className="retrieval-empty">
              没有找到相关片段，试试资料中使用的关键词，或先补充项目资料。
            </p>
          )}
        </>
      )}
    </section>
  );
}
