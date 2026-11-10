import { useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Link2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useApp } from "./context";
import { Avatar } from "./components";
import { priorityText, type PlanItem, type Priority } from "./domain";
import { allocationWarnings } from "./insights";
import { rankMembers } from "../shared/matching.mjs";
import { ContractFields } from "./automation-ui";

export function AllocationReview({
  plan,
  change,
  remove,
}: {
  plan: PlanItem[];
  change: (i: number, patch: Partial<PlanItem>) => void;
  remove: (i: number) => void;
}) {
  const { state } = useApp();
  const [expanded, setExpanded] = useState<number | null>(0);
  const warnings = allocationWarnings(plan, state);
  const departments = [
    ...new Set(
      plan.flatMap((p) => {
        const m = state.members.find((m) => m.id === p.ownerId);
        return m ? [m.department] : [];
      }),
    ),
  ];
  return (
    <div className="allocation-review">
      <div className="allocation-route">
        <span>
          <Users size={14} />
          {departments.length} 个部门协作
        </span>
        {departments.map((d) => (
          <i key={d}>{d}</i>
        ))}
        <small>{plan.filter((p) => !p.ownerId).length} 项未分配</small>
      </div>
      {warnings.length > 0 && (
        <div className="allocation-warnings">
          <TriangleAlert size={16} />
          <div>
            <strong>分工容量提醒</strong>
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        </div>
      )}
      <div className="allocation-list">
        {plan.map((item, i) => {
          const owner = state.members.find((m) => m.id === item.ownerId);
          const ranking = rankMembers(
            item.skills,
            state.members,
            [
              ...state.tasks,
              ...plan
                .filter((_, index) => index !== i)
                .map((p) => ({ ...p, status: "todo" })),
            ],
            item.estimatedHours || 0,
          );
          return (
            <article className="allocation-task" key={i}>
              <div className="allocation-task-top">
                <span className="allocation-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <input
                  aria-label={`任务 ${i + 1} 标题`}
                  maxLength={200}
                  value={item.title}
                  onChange={(e) => change(i, { title: e.target.value })}
                />
                <button
                  className="icon-button"
                  aria-label={`移除任务 ${i + 1}`}
                  onClick={() => remove(i)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <textarea
                aria-label={`任务 ${i + 1} 要求`}
                rows={3}
                value={item.description}
                maxLength={10000}
                onChange={(e) => change(i, { description: e.target.value })}
              />
              <div className="allocation-meta">
                <label>
                  <span>负责人</span>
                  <select
                    aria-label={`任务 ${i + 1} 负责人`}
                    value={item.ownerId}
                    onChange={(e) =>
                      change(i, {
                        ownerId: e.target.value,
                        reason: "由你手动指定",
                      })
                    }
                  >
                    <option value="">待分配</option>
                    {state.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.department} / {m.name}
                        {m.availability === "paused" ? "（暂停）" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>工时</span>
                  <input
                    aria-label={`任务 ${i + 1} 工时`}
                    type="number"
                    min="0.5"
                    max="80"
                    step="0.5"
                    value={item.estimatedHours}
                    onChange={(e) =>
                      change(i, { estimatedHours: e.target.valueAsNumber })
                    }
                  />
                  h
                </label>
                <select
                  aria-label={`任务 ${i + 1} 优先级`}
                  value={item.priority}
                  onChange={(e) =>
                    change(i, { priority: e.target.value as Priority })
                  }
                >
                  {Object.entries(priorityText).map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <ContractFields
                task={item}
                change={(patch) => change(i, patch)}
                prefix={`任务 ${i + 1} `}
              />
              <div className="allocation-dependencies">
                <Link2 size={13} />
                <span>前置任务</span>
                {i === 0 ? (
                  <small>无，可直接开始</small>
                ) : (
                  <select
                    multiple
                    aria-label={`任务 ${i + 1} 前置任务`}
                    value={(item.dependsOn || []).map(String)}
                    onChange={(e) =>
                      change(i, {
                        dependsOn: Array.from(e.target.selectedOptions).map(
                          (o) => Number(o.value),
                        ),
                      })
                    }
                  >
                    {plan.slice(0, i).map((p, n) => (
                      <option key={n} value={n}>
                        {String(n + 1).padStart(2, "0")} ·{" "}
                        {p.title || "未命名任务"}
                      </option>
                    ))}
                  </select>
                )}
                {!!item.dependsOn?.length && (
                  <button onClick={() => change(i, { dependsOn: [] })}>
                    清除前置
                  </button>
                )}
              </div>
              <button
                className="compare-assignees"
                onClick={() => setExpanded(expanded === i ? null : i)}
              >
                <Sparkles size={13} />
                <span>
                  {owner
                    ? `已分配给 ${owner.name} · ${owner.department}`
                    : "尚未分配负责人"}
                </span>
                <b>
                  <SlidersHorizontal size={12} />
                  比较候选人
                  <ChevronDown size={12} />
                </b>
              </button>
              {expanded === i && (
                <div className="candidate-comparison">
                  <div className="comparison-caption">
                    匹配分 = 技能等级与覆盖（75%）+ 分配后剩余容量（25%）
                    <small>
                      技能默认 3/5，可在员工档案调整；分数只用于当前任务排序。
                    </small>
                  </div>
                  {ranking.slice(0, 5).map((r) => (
                    <button
                      className={item.ownerId === r.member.id ? "selected" : ""}
                      disabled={!r.available}
                      key={r.member.id}
                      onClick={() =>
                        change(i, { ownerId: r.member.id, reason: r.reason })
                      }
                    >
                      <Avatar member={r.member} size="small" />
                      <div>
                        <strong>
                          {r.member.name}
                          <small>{r.member.role}</small>
                        </strong>
                        <p>{r.reason}</p>
                      </div>
                      <span className="candidate-score">
                        {r.score}
                        <small>匹配分</small>
                      </span>
                      {item.ownerId === r.member.id ? (
                        <Check size={15} />
                      ) : (
                        <ArrowRight size={14} />
                      )}
                    </button>
                  ))}
                  {!ranking.length && (
                    <p className="muted">暂无员工，创建计划后可再分配。</p>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
