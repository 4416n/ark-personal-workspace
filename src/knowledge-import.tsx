import { useRef, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { useApp } from "./context";
import { Modal } from "./components";
import { now, uid, stateSchema } from "./domain";
import { readKnowledgeFiles, previewKnowledgeImport, applyKnowledgeImport, type ImportFile, type ImportPreview, type ImportAction } from "../shared/knowledge-import.mjs";
import "./knowledge-import.css";

export function KnowledgeImport() {
  const { state, update, notify } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [preview, setPreview] = useState<ImportPreview[]>([]);
  const [projectId, setProjectId] = useState("");
  const [choices, setChoices] = useState<Record<string, ImportAction>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const prepare = (nextFiles: ImportFile[], scope: string) => {
    setPreview(previewKnowledgeImport(nextFiles, state.knowledge, scope));
    setChoices({});
    setError("");
  };
  const active = preview.filter((row) => (choices[row.id] || (row.status === "new" ? "add" : "skip")) !== "skip");
  const replacing = active.filter((row) => choices[row.id] === "replace").length;
  return <>
    <input ref={input} type="file" hidden multiple accept=".md,.markdown,.txt" aria-label="选择导入资料文件" onChange={async (event) => {
      const selected = Array.from(event.target.files || []);
      event.target.value = "";
      if (!selected.length) return;
      setBusy(true);
      try {
        const decoded = await readKnowledgeFiles(selected);
        setFiles(decoded);
        prepare(decoded, projectId);
      } catch (e) { notify((e as Error).message, true); }
      finally { setBusy(false); }
    }} />
    <button className="button" disabled={busy} onClick={() => input.current?.click()}><ArrowDownToLine size={16} />{busy ? "读取资料…" : "导入资料"}</button>
    {!!files.length && <Modal wide title="核对资料导入" subtitle="文件先在本机读取；确认后保存，导入过程不调用模型。" onClose={() => setFiles([])}>
      <div className="modal-body knowledge-import-body">
        <label className="field">导入范围<select aria-label="资料导入范围" value={projectId} onChange={(event) => { setProjectId(event.target.value); prepare(files, event.target.value); }}>
          <option value="">公共知识 · 所有项目可检索</option>
          {state.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
        </select><small>重复判断仅比较此范围。支持 UTF-8 TXT / Markdown，最多 20 个、每个 200 KB / 10 万字符、合计 2 MB。</small></label>
        <p className="field-hint">同正文自动跳过；同名默认保留。选择“替换原资料”会覆盖其正文，请先核对。原始文件不会修改。</p>
        <div className="knowledge-import-list">
          {preview.map((row) => <article className={`knowledge-import-item ${row.status}`} key={row.id}>
            <div className="knowledge-import-file"><strong>{row.name}</strong><span>{(row.bytes / 1000).toFixed(1)} KB · {row.content.length.toLocaleString()} 字符</span></div>
            <p role={row.status === "invalid" ? "alert" : undefined}>{row.message}</p>
            {row.modifiedAt && <small>文件更新时间：{new Date(row.modifiedAt).toLocaleString("zh-CN")}</small>}
            {!["invalid", "duplicate"].includes(row.status) && <>
              <label className="field">处理方式<select aria-label={`处理 ${row.name}`} value={choices[row.id] || (row.status === "new" ? "add" : "skip")} onChange={(event) => setChoices((current) => ({ ...current, [row.id]: event.target.value as ImportAction }))}>
                <option value="skip">跳过，保留现有资料</option>
                {row.status === "new" && <option value="add">加入知识空间</option>}
                {row.status === "conflict" && <option value="copy">另存副本</option>}
                {row.target && <option value="replace">替换原资料正文</option>}
              </select></label>
              <details><summary>查看正文预览</summary><pre>{row.content.slice(0, 2500)}{row.content.length > 2500 ? "\n…（预览前 2500 字符，导入会保留完整正文）" : ""}</pre></details>
            </>}
          </article>)}
        </div>
        {error && <p className="alert error" role="alert">{error}</p>}
      </div>
      <footer className="modal-footer knowledge-import-footer">
        <span>{active.length} 份待导入{replacing ? `，其中 ${replacing} 份替换现有正文` : ""}</span>
        <div className="inline-controls"><button className="button" onClick={() => setFiles([])}>取消</button><button className="button" onClick={() => prepare(files, projectId)}>重新核对</button><button className="button primary" disabled={!active.length} onClick={() => {
          try {
            let counts = "";
            update((current) => {
              if (projectId && !current.projects.some((project) => project.id === projectId)) throw new Error("所选项目已不存在，请重新选择导入范围。");
              const result = applyKnowledgeImport(current.knowledge, preview, choices, { projectId, importedAt: now(), createId: uid });
              const next = { ...current, knowledge: result.knowledge };
              if (!stateSchema.safeParse(next).success) throw new Error("资料超出工作台限制，未导入；请缩小批次或整理现有资料。");
              if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 10 * 1024 * 1024 - 65536) throw new Error("工作台数据接近 10 MiB 保存上限，请先备份并整理资料后再导入。");
              counts = `新增 ${result.added} 份、替换 ${result.replaced} 份、跳过 ${result.skipped} 份`;
              return next;
            }, `批量导入资料：${active.length} 份`);
            setFiles([]);
            notify(`资料导入完成：${counts}`);
          } catch (e) { setError((e as Error).message); }
        }}>确认导入 {active.length} 份</button></div>
      </footer>
    </Modal>}
  </>;
}
