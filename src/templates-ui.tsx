import { useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useApp } from "./context";
import { Modal, Empty } from "./components";
import { dateIn, stateSchema, type ProjectTemplate } from "./domain";
import { instantiateTemplate } from "./templates";
export function TemplateLibrary() {
  const { state, update, open, notify } = useApp();
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<ProjectTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState(dateIn(14));
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ReturnType<
    typeof instantiateTemplate
  > | null>(null);
  return (
    <>
      <button className="button" onClick={() => setVisible(true)}>
        <Copy size={16} />
        流程模板{state.templates?.length ? ` · ${state.templates.length}` : ""}
      </button>
      {visible && (
        <Modal
          wide
          title="我的流程模板"
          subtitle="复用验证过的任务与分工，让下一次项目更快开始。"
          onClose={() => {
            setVisible(false);
            setSelected(null);
            setPreview(null);
          }}
        >
          <div className="modal-body">
            {!state.templates?.length ? (
              <Empty
                title="把跑顺的项目存成模板"
                description="打开任意项目，点击「保存为流程模板」。模板保留任务、前置关系、验收要求与相对排期，不包含旧成果。"
              />
            ) : (
              <div className="template-list">
                {state.templates.map((t) => (
                  <article key={t.id}>
                    <button
                      onClick={() => {
                        setSelected(t);
                        setTitle(t.name);
                        setPreview(null);
                        setError("");
                      }}
                      aria-pressed={selected?.id === t.id}
                    >
                      <Copy size={18} />
                      <div>
                        <h3>{t.name}</h3>
                        <p>
                          {t.tasks.length} 项任务 ·{" "}
                          {t.tasks.reduce((n, x) => n + x.estimatedHours, 0)}h
                          计划工时
                        </p>
                      </div>
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`删除模板${t.name}`}
                      onClick={() => {
                        if (
                          confirm(
                            `删除模板「${t.name}」？已创建的项目不受影响。`,
                          )
                        ) {
                          update(
                            (s) => ({
                              ...s,
                              templates: s.templates?.filter(
                                (x) => x.id !== t.id,
                              ),
                            }),
                            `删除流程模板：${t.name}`,
                          );
                          if (selected?.id === t.id) setSelected(null);
                        }
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </article>
                ))}
              </div>
            )}
            {selected && (
              <form
                className="template-create"
                onSubmit={(e) => {
                  e.preventDefault();
                  try {
                    setPreview(
                      instantiateTemplate(selected, state, title, deadline),
                    );
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <label className="field">
                  新项目名称
                  <input
                    required
                    maxLength={100}
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setPreview(null);
                    }}
                  />
                </label>
                <label className="field">
                  新项目截止日期
                  <input
                    required
                    type="date"
                    value={deadline}
                    onChange={(e) => {
                      setDeadline(e.target.value);
                      setPreview(null);
                    }}
                  />
                </label>
                <p>{selected.goal}</p>
                <button className="button" type="submit">
                  预览排期与分工
                </button>
              </form>
            )}
            {preview && (
              <div className="template-preview">
                <p>
                  暂停或已移除的员工会重新匹配。创建后可在任务中调整分工、日期与要求。
                </p>
                {preview.tasks.map((t, i) => (
                  <div key={t.id}>
                    <strong>
                      {i + 1}. {t.title}
                    </strong>
                    <span>
                      {state.members.find((m) => m.id === t.ownerId)?.name ||
                        "待分配"}{" "}
                      · {t.deadline} · 前置 {t.dependsOn?.length || 0} 项
                    </span>
                  </div>
                ))}
              </div>
            )}
            {error && <p className="alert error">{error}</p>}
          </div>
          <footer className="modal-footer">
            <span>旧成果与审批记录不会复制</span>
            <button
              className="button primary"
              disabled={!preview}
              onClick={() => {
                if (!preview) return;
                const next = {
                  ...state,
                  projects: [preview.project, ...state.projects],
                  tasks: [...preview.tasks, ...state.tasks],
                };
                if (!stateSchema.safeParse(next).success) {
                  setError("模板内容或排期无效，请检查后重试");
                  return;
                }
                update(() => next, `从模板创建项目：${preview.project.title}`);
                setVisible(false);
                open({ type: "project", id: preview.project.id });
                notify("已从模板创建新项目");
              }}
            >
              <Plus size={16} />
              确认创建项目
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
