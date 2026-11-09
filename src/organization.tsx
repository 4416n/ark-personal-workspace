import { useRef, useState } from "react";
import {
  ArrowUpRight,
  Plus,
  Search,
  Bot,
  Download,
  Upload,
  X,
  Check,
  BriefcaseBusiness,
  SlidersHorizontal,
  Pause,
  Play,
  ShieldCheck,
} from "lucide-react";
import { useApp } from "./context";
import { Avatar, Modal, PageHeading, TaskRow, Empty } from "./components";
import { memberSchema, departmentSchema, uid, type Member } from "./domain";
import { departmentNames, departmentStats, memberLoad } from "./insights";
import { download } from "./store";
import { z } from "zod";

const library: Omit<Member, "id">[] = [
  {
    name: "小研",
    role: "研究分析师",
    department: "研究部",
    color: "blue",
    skills: ["调研", "竞品分析", "数据分析", "需求分析"],
    skillLevels: { 调研: 5, 竞品分析: 4, 数据分析: 4, 需求分析: 4 },
    capacity: 32,
    type: "ai",
    traits: ["重证据", "结构化", "审慎"],
    prompt:
      "你是研究分析师。依据给定资料整理事实、假设和缺失证据，输出有结论的研究报告。不得编造来源或声称已联网调查。",
  },
  {
    name: "小营",
    role: "增长运营师",
    department: "运营部",
    color: "orange",
    skills: ["营销", "内容策划", "用户增长", "复盘"],
    skillLevels: { 营销: 4, 内容策划: 4, 用户增长: 4, 复盘: 5 },
    capacity: 32,
    type: "ai",
    traits: ["结果导向", "小步实验"],
    prompt:
      "你是增长运营师。从获客、转化、留存角度提出可以小成本验证的方案，明确衡量指标和停止条件。对预测数据明确标注假设。",
  },
  {
    name: "小审",
    role: "质量审核员",
    department: "质检部",
    color: "green",
    skills: ["验收", "测试", "需求分析", "代码"],
    skillLevels: { 验收: 5, 测试: 4, 需求分析: 4, 代码: 3 },
    capacity: 24,
    type: "ai",
    traits: ["关注边界", "细致"],
    prompt:
      "你是质量审核员。对照任务验收标准评审提交内容，列出具体缺陷、风险和可操作的修改建议，不得假称运行过测试。",
  },
  {
    name: "小财",
    role: "预算规划师",
    department: "财务部",
    color: "pink",
    skills: ["预算", "数据分析", "成本测算", "复盘"],
    skillLevels: { 预算: 5, 数据分析: 4, 成本测算: 4, 复盘: 3 },
    capacity: 24,
    type: "ai",
    traits: ["量化", "成本意识"],
    prompt:
      "你是个人项目预算规划师。依据用户提供的金额和约束分析成本、预算情景和资金需求，区分已有数据和假设，不编造实际收支。",
  },
];
export function Organization() {
  const { state, update, open, notify } = useApp();
  const [department, setDepartment] = useState("all");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [recruit, setRecruit] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<Member[] | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const names = departmentNames(state);
  const members = state.members.filter(
    (m) =>
      (department === "all" || m.department === department) &&
      `${m.name} ${m.role} ${m.skills.join(" ")} ${(m.traits || []).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "available"
          ? m.availability !== "paused" && memberLoad(state, m).load < 100
          : filter === "paused"
            ? m.availability === "paused"
            : memberLoad(state, m).load >= 100)),
  );
  const loadImport = async (f?: File) => {
    if (!f) return;
    try {
      if (f.size > 1000000) throw new Error("名册最大支持 1 MB");
      const parsed = z
        .array(memberSchema.omit({ id: true }))
        .min(1)
        .max(100)
        .parse(JSON.parse(await f.text()));
      setPending(parsed.map((m) => ({ ...m, id: uid() })));
    } catch (e) {
      notify(
        e instanceof z.ZodError
          ? "名册格式无效，请先导出名册作为模板"
          : e instanceof SyntaxError
            ? "请选择有效的 JSON 员工名册"
            : (e as Error).message,
        true,
      );
    }
  };
  return (
    <>
      <PageHeading
        title="团队"
        description={`共 ${state.members.length} 位成员 · ${names.length} 个部门。按能力、标签和计划负载安排工作。`}
        action={
          <div className="inline-controls">
            <button
              className="button"
              onClick={() => open({ type: "department", name: "" })}
            >
              <BriefcaseBusiness size={14} />
              部门管理
            </button>
            <button className="button" onClick={() => setRecruit(true)}>
              <Bot size={14} />
              角色库
            </button>
            <button
              className="button primary"
              onClick={() => open({ type: "member" })}
            >
              <Plus size={15} />
              添加员工
            </button>
          </div>
        }
      />
      <div className="org-departments">
        {names.map((name, i) => {
          const d = departmentStats(state, name);
          return (
            <button
              className={`org-dept ${department === name ? "selected" : ""}`}
              key={name}
              style={
                {
                  "--department-color": [
                    "#9382c6",
                    "#73a1ba",
                    "#c7a270",
                    "#7ca792",
                    "#bd8daa",
                  ][i % 5],
                } as React.CSSProperties
              }
              onClick={() => setDepartment(name === department ? "all" : name)}
            >
              <div>
                <strong>{name}</strong>
                <span>{d.members.length} 人</span>
              </div>
              <div className="org-dept-avatars">
                {d.members.slice(0, 5).map((m) => (
                  <Avatar member={m} key={m.id} size="small" />
                ))}
                {d.members.length > 5 && <small>+{d.members.length - 5}</small>}
              </div>
              <footer>
                <span>{d.active.length} 项待办</span>
                <b className={d.load > 100 ? "overdue" : ""}>{d.load}% 负载</b>
              </footer>
            </button>
          );
        })}
        <button
          className="org-add-dept"
          onClick={() => open({ type: "department", name: "" })}
        >
          <Plus size={21} />
          <span>新建部门</span>
        </button>
      </div>
      <div className="org-toolbar">
        <div className="search-field">
          <Search size={15} />
          <input
            aria-label="搜索员工"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索姓名、岗位、技能或标签"
          />
        </div>
        <div className="org-filters">
          <button
            className={department === "all" ? "active" : ""}
            onClick={() => setDepartment("all")}
          >
            全部员工
          </button>
          <select
            aria-label="按接单状态筛选"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">全部状态</option>
            <option value="available">有余量</option>
            <option value="overloaded">满载 / 超载</option>
            <option value="paused">暂停接单</option>
          </select>
          {department !== "all" && (
            <button
              className="org-filter-tag"
              onClick={() => setDepartment("all")}
            >
              {department}
              <X size={11} />
            </button>
          )}
        </div>
        <div className="org-import-tools">
          <input
            ref={file}
            type="file"
            hidden
            accept=".json"
            onChange={(e) => {
              void loadImport(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            aria-label="导入员工名册"
            onClick={() => file.current?.click()}
          >
            <Upload size={15} />
          </button>
          <button
            aria-label="导出员工名册"
            onClick={() =>
              download(
                "方舟员工名册.json",
                JSON.stringify(
                  state.members.map(({ id: _id, ...m }) => m),
                  null,
                  2,
                ),
              )
            }
          >
            <Download size={15} />
          </button>
        </div>
      </div>
      <p className="mobile-table-hint">
        左右滑动表格，查看技能、负载与接单状态 →
      </p>
      <div className="org-table-scroll">
        <table className="org-table">
          <thead>
            <tr>
              <th>姓名 / 身份</th>
              <th>部门 / 职位</th>
              <th>
                能力配置{" "}
                <span title="技能等级的平均值，未配置技能默认 3/5；这是你的配置，不是 AI 能力评测。">
                  ⓘ
                </span>
              </th>
              <th>技能与风格标签</th>
              <th>计划负载</th>
              <th>接单状态</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const l = memberLoad(state, m);
              const score = m.skills.length
                ? m.skills.reduce(
                    (sum, skill) => sum + (m.skillLevels?.[skill] ?? 3),
                    0,
                  ) / m.skills.length
                : 0;
              return (
                <tr key={m.id}>
                  <td>
                    <button
                      className="org-person"
                      onClick={() => open({ type: "member", id: m.id })}
                    >
                      <Avatar member={m} />
                      <span>
                        <strong>{m.name}</strong>
                        <small>
                          {m.type === "ai" ? "AI EMPLOYEE" : "TEAM MEMBER"}
                        </small>
                      </span>
                    </button>
                  </td>
                  <td>
                    <button
                      className="table-dept-link"
                      onClick={() =>
                        open({ type: "department", name: m.department })
                      }
                    >
                      <i className={m.color} />
                      {m.department}
                    </button>
                    <small>{m.role}</small>
                  </td>
                  <td>
                    <div className="ability-score">
                      <strong>{score.toFixed(1)}</strong>
                      <small>/ 5</small>
                      <div>
                        <span style={{ width: `${score * 20}%` }} />
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="org-skill-tags">
                      {m.skills.slice(0, 3).map((skill) => (
                        <span className={m.color} key={skill}>
                          {skill}
                        </span>
                      ))}
                      {m.skills.length > 3 && (
                        <span>+{m.skills.length - 3}</span>
                      )}
                    </div>
                    <div className="org-traits">
                      {m.traits?.slice(0, 3).join(" · ") ||
                        "可在档案中设置工作风格"}
                    </div>
                  </td>
                  <td>
                    <div className="load-cell">
                      <span className={l.load > 100 ? "overdue" : ""}>
                        {l.load}%
                        <small>
                          {l.hours}/{m.capacity}h
                        </small>
                      </span>
                      <div className="progress-track">
                        <span
                          className={l.load > 100 ? "orange" : m.color}
                          style={{ width: `${Math.min(100, l.load)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td>
                    <button
                      className={`availability-toggle ${m.availability === "paused" ? "paused" : ""}`}
                      aria-label={`${m.availability === "paused" ? "恢复" : "暂停"}${m.name}接单`}
                      onClick={() => {
                        update(
                          (s) => ({
                            ...s,
                            members: s.members.map((x) =>
                              x.id === m.id
                                ? {
                                    ...x,
                                    availability:
                                      x.availability === "paused"
                                        ? "available"
                                        : "paused",
                                  }
                                : x,
                            ),
                          }),
                          `${m.name}${m.availability === "paused" ? "恢复" : "暂停"}接单`,
                        );
                      }}
                    >
                      {m.availability === "paused" ? (
                        <Pause size={10} />
                      ) : (
                        <Play size={10} />
                      )}{" "}
                      {m.availability === "paused" ? "已暂停" : "可接单"}
                    </button>
                  </td>
                  <td>
                    <button
                      className="table-edit"
                      onClick={() => open({ type: "member", id: m.id })}
                    >
                      档案
                      <ArrowUpRight size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!members.length && (
          <Empty
            title="没有符合条件的员工"
            description="调整筛选条件，或为公司添加新伙伴。"
          />
        )}
      </div>
      <div className="org-footer">
        <span>
          显示 {members.length} / {state.members.length} 位成员
        </span>
        <span>
          <ShieldCheck size={12} />
          技能等级参与任务推荐 · 暂停员工不再被自动分配
        </span>
      </div>
      {recruit && (
        <Modal
          wide
          title="招募你的下一位 AI 伙伴"
          subtitle="角色模板可以直接加入团队，能力与指令都可继续编辑。"
          onClose={() => setRecruit(false)}
        >
          <div className="recruit-grid modal-body">
            {library.map((m) => (
              <button
                className={`recruit-card ${selected.includes(m.name) ? "selected" : ""}`}
                key={m.name}
                onClick={() =>
                  setSelected((s) =>
                    s.includes(m.name)
                      ? s.filter((n) => n !== m.name)
                      : [...s, m.name],
                  )
                }
              >
                <Avatar member={{ ...m, id: m.name }} size="large" />
                <h3>
                  {m.name} <span>{m.role}</span>
                </h3>
                <p>{m.prompt}</p>
                <div>
                  {m.skills.map((skill) => (
                    <span key={skill}>{skill}</span>
                  ))}
                </div>
                <i>
                  {selected.includes(m.name) ? (
                    <Check size={14} />
                  ) : (
                    <Plus size={14} />
                  )}
                </i>
              </button>
            ))}
          </div>
          <footer className="modal-footer">
            <span>已选择 {selected.length} 位伙伴</span>
            <button
              className="button primary"
              disabled={!selected.length}
              onClick={() => {
                const additions = library
                  .filter((m) => selected.includes(m.name))
                  .map((m) => ({ ...m, id: uid() }));
                if (state.members.length + additions.length > 500) {
                  notify("员工总数不能超过 500", true);
                  return;
                }
                update(
                  (s) => ({ ...s, members: [...s.members, ...additions] }),
                  `招募 ${additions.length} 位 AI 伙伴`,
                );
                setRecruit(false);
                setSelected([]);
                notify(`${additions.length} 位伙伴已加入，办公室已同步更新`);
              }}
            >
              <Plus size={14} />
              加入我的公司
            </button>
          </footer>
        </Modal>
      )}
      {pending && (
        <Modal
          title="导入员工名册"
          subtitle="采用追加导入，现有员工与任务不会被替换。"
          onClose={() => setPending(null)}
        >
          <div className="modal-body">
            <p>
              将新增 {pending.length} 位员工，涉及{" "}
              {[...new Set(pending.map((m) => m.department))].join("、")}。
            </p>
            <div className="import-names">
              {pending.map((m) => (
                <span key={m.id}>
                  {m.name} · {m.role}
                </span>
              ))}
            </div>
          </div>
          <footer className="modal-footer">
            <button className="button" onClick={() => setPending(null)}>
              取消
            </button>
            <button
              className="button primary"
              onClick={() => {
                if (state.members.length + pending.length > 500) {
                  notify("员工总数不能超过 500", true);
                  return;
                }
                update(
                  (s) => ({ ...s, members: [...s.members, ...pending] }),
                  `导入 ${pending.length} 位员工`,
                );
                setPending(null);
                notify("名册导入完成");
              }}
            >
              确认导入
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
export function DepartmentDetail({
  name,
  close,
}: {
  name: string;
  close: () => void;
}) {
  const { state, update, open, notify } = useApp();
  const existing = state.departments.find((d) => d.name === name);
  const [editing, setEditing] = useState(!name);
  const [draft, setDraft] = useState(
    existing || { name, mission: "", leadId: "", budget: 0 },
  );
  const d = departmentStats(state, name);
  const [error, setError] = useState("");
  return (
    <Modal
      wide
      title={name || "建立一个新部门"}
      subtitle={
        name
          ? `${d.members.length} 位成员 · ${d.active.length} 项待办 · ${d.hours}h 计划工作量`
          : "为部门定义职责和负责人，员工按所属部门自动入驻办公室。"
      }
      onClose={close}
    >
      <div className="modal-body">
        {editing ? (
          <form
            className="form-grid"
            id="department-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                !draft.name.trim() ||
                (draft.name.trim() !== name &&
                  departmentNames(state).includes(draft.name.trim()))
              ) {
                setError("部门名称不能为空或与已有部门重名");
                return;
              }
              const next = { ...draft, name: draft.name.trim() };
              if (
                !departmentSchema.safeParse(next).success ||
                (!existing && state.departments.length >= 100)
              ) {
                setError("请检查部门信息与预算，部门资料最多 100 份");
                return;
              }
              update(
                (s) => ({
                  ...s,
                  departments: [
                    ...s.departments.filter((x) => x.name !== name),
                    next,
                  ],
                  members: name
                    ? s.members.map((m) =>
                        m.department === name
                          ? { ...m, department: next.name }
                          : m,
                      )
                    : s.members,
                }),
                `${name ? "更新" : "新建"}部门：${next.name}`,
              );
              notify("部门资料已保存");
              close();
            }}
          >
            <label className="field">
              部门名称
              <input
                required
                maxLength={50}
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
              />
            </label>
            <label className="field">
              部门负责人
              <select
                value={draft.leadId}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, leadId: e.target.value }))
                }
              >
                <option value="">暂未指定</option>
                {d.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.role}
                  </option>
                ))}
              </select>
            </label>
            <label className="field full">
              部门职责
              <textarea
                rows={4}
                maxLength={2000}
                value={draft.mission}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, mission: e.target.value }))
                }
                placeholder="这个部门负责什么，交付什么，如何判断做得好？"
              />
            </label>
            <label className="field full">
              计划预算（元）
              <input
                type="number"
                min="0"
                max="100000000"
                required
                value={draft.budget}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, budget: e.target.valueAsNumber }))
                }
              />
              <small>仅用于预算规划，不代表实际支出。</small>
            </label>
            {error && <div className="alert error full">{error}</div>}
          </form>
        ) : (
          <>
            <div className="department-profile">
              <div>
                <span className={`dept-symbol ${d.color}`}>
                  <BriefcaseBusiness size={24} />
                </span>
                <div>
                  <strong>{existing?.mission || "还未填写部门职责"}</strong>
                  <p>
                    负责人：
                    {state.members.find((m) => m.id === existing?.leadId)
                      ?.name || "未指定"}{" "}
                    · 计划预算 ¥{(existing?.budget || 0).toLocaleString()}
                  </p>
                </div>
              </div>
              <button className="button" onClick={() => setEditing(true)}>
                <SlidersHorizontal size={14} />
                编辑部门
              </button>
            </div>
            <div className="department-counters">
              <span>
                <b>{d.active.length}</b>待完成
              </span>
              <span>
                <b>{d.review}</b>待验收
              </span>
              <span>
                <b>{d.overdue}</b>逾期
              </span>
              <span>
                <b>{d.load}%</b>计划负载
              </span>
            </div>
            <div className="department-members">
              {d.members.map((m) => (
                <button
                  key={m.id}
                  onClick={() => open({ type: "member", id: m.id })}
                >
                  <Avatar member={m} />
                  <div>
                    <strong>{m.name}</strong>
                    <span>{m.role}</span>
                  </div>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
            <div className="section-heading">
              <h2>部门任务</h2>
              <small>{d.done} 项已完成</small>
            </div>
            {d.active.map((t) => (
              <TaskRow task={t} key={t.id} />
            ))}
            {!d.active.length && (
              <Empty
                title="这个部门目前没有待办"
                description="在目标拆解中分配任务，或从任务看板手动安排。"
              />
            )}
          </>
        )}
      </div>
      <footer className="modal-footer">
        <span>
          {name
            ? `办公室已关联 ${d.members.length} 个工位`
            : "你可以在员工档案中调整所属部门"}
        </span>
        {editing ? (
          <button
            className="button primary"
            type="submit"
            form="department-form"
          >
            <Check size={14} />
            保存部门
          </button>
        ) : (
          <button className="button" onClick={close}>
            返回办公室
          </button>
        )}
      </footer>
    </Modal>
  );
}
