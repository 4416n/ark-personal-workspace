import { randomUUID } from "node:crypto";
import { z } from "zod";
import { taskContract } from "../shared/contract.mjs";
import {
  replaceResult,
  ensureResultMeta,
  recordReview,
  boundWorkspaceHistory,
} from "../src/delivery.ts";
import {
  generationMessages,
  reviewMessages,
  parseReview,
} from "./work-output.mjs";
import { completeLongForm } from "./long-form.mjs";

const inputSchema = z.object({
  confirmed: z.literal(true),
  revision: z.number().int().min(1),
  mode: z.enum(["auto", "manual"]),
  maxCalls: z.number().int().min(2).max(100),
  maxReworks: z.number().int().min(0).max(2),
});
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function projectAutomation({
  database,
  runs,
  completion,
  readConfig,
  isSoftwareActive = () => false,
}) {
  const jobs = new Map(
    (database?.listAutomations() || []).map((j) => [j.projectId, j]),
  );
  const active = new Map();
  let closed = false;
  const save = (job, note) => {
    if (closed) return;
    job.updatedAt = new Date().toISOString();
    if (note) {
      job.note = note;
      job.events = [
        { at: job.updatedAt, text: note },
        ...(job.events || []),
      ].slice(0, 100);
    }
    database.saveAutomation(job);
    jobs.set(job.projectId, job);
  };
  for (const job of jobs.values())
    if (["running", "pausing"].includes(job.status)) {
      job.status = "paused";
      save(
        job,
        "电脑服务已重启，自动执行已暂停；确认后才能恢复，不会自行消耗额度",
      );
    }
  function scope(state, projectId) {
    return {
      project: state.projects.find((p) => p.id === projectId),
      tasks: state.tasks.filter((t) => t.projectId === projectId),
    };
  }
  function guardWrite(next) {
    if (!database || !active.size) return;
    const current = database.read().state;
    for (const id of active.keys())
      if (!equal(scope(current, id), scope(next, id)))
        throw fail(
          "该项目正在自动执行，请先暂停并等候停止，再编辑任务、验收或恢复备份；修改仍留在当前页面",
          423,
        );
  }
  function readInput(job, taskId) {
    const snapshot = database.read();
    const state = snapshot.state;
    const project = state?.projects.find((p) => p.id === job.projectId);
    if (!project || project.status !== "active")
      throw fail("项目已暂停、结束或删除，请检查后恢复执行");
    const task = state.tasks.find(
      (t) => t.id === taskId && t.projectId === job.projectId,
    );
    if (!task) throw fail("任务已删除，执行已停止");
    const member = state.members.find((m) => m.id === task.ownerId);
    if (
      !member ||
      member.type !== "ai" ||
      member.availability === "paused" ||
      taskContract(task).executionMode === "human"
    )
      throw fail("任务需要人工或员工不可用，请检查分工");
    const dependencies = state.tasks.filter((t) =>
      task.dependsOn?.includes(t.id),
    );
    if (dependencies.some((t) => t.status !== "done"))
      throw fail("前置任务尚未完成");
    return {
      snapshot,
      input: {
        task,
        project,
        member,
        dependencies,
        knowledge: state.knowledge.filter(
          (n) => !n.projectId || n.projectId === project.id,
        ),
      },
    };
  }
  function writeTask(job, previous, transform) {
    const latest = readInput(job, previous.task.id);
    if (!equal(latest.input, previous))
      throw fail(
        "任务、角色或项目资料已变化，结果只保留在 AI 执行记录中，未覆盖新内容；请检查后恢复",
        409,
      );
    const state = latest.snapshot.state;
    const next = transform(latest.input.task);
    const drafted = {
      ...state,
      tasks: boundWorkspaceHistory(
        state.tasks.map((t) => (t.id === next.id ? next : t)),
      ),
      activity: [
        {
          id: randomUUID(),
          text: `自动执行：${next.title} · ${next.status === "done" ? "AI 审查通过" : "成果/审查已更新"}`.slice(
            0,
            500,
          ),
          at: new Date().toISOString(),
        },
        ...state.activity,
      ].slice(0, 100),
    };
    database.save(drafted, latest.snapshot.revision);
  }
  function blocked(job, task, state) {
    if (task.status === "done") return "";
    const owner = state.members.find((m) => m.id === task.ownerId);
    if (task.executionMode === "human" || owner?.type === "human")
      return "需要人工操作并验收";
    if (!owner || owner.availability === "paused")
      return "需要分配可用的 AI 员工";
    if (
      task.dependsOn?.some(
        (id) => state.tasks.find((t) => t.id === id)?.status !== "done",
      )
    )
      return "等待前置任务通过";
    const review =
      task.aiReview?.versionId === task.resultMeta?.id ? task.aiReview : null;
    if (review?.requiresHuman) return "审查指出需要人工核实或外部操作";
    if (review?.passed && job.mode === "manual")
      return "AI 审查通过，等待人工验收";
    if (
      review &&
      !review.passed &&
      (job.reworks?.[task.id] || 0) >= job.maxReworks
    )
      return "已达到返工上限，请人工修改成果或调整要求";
    return "";
  }
  async function execute(job, control, config) {
    try {
      while (!control.signal.aborted && !closed) {
        const state = database.read().state;
        if (
          !state?.projects.some(
            (p) => p.id === job.projectId && p.status === "active",
          )
        )
          throw fail("项目已暂停、结束或删除");
        const items = job.taskIds.map((id) =>
          state.tasks.find((t) => t.id === id),
        );
        if (items.some((t) => !t))
          throw fail("执行范围中的任务已删除，请重新确认计划");
        if (items.every((t) => t.status === "done")) {
          job.status = "completed";
          job.phase = "idle";
          save(
            job,
            "本批任务已完成，交付包已汇总；请确认项目整体目标，不会自动宣称现实业务达成",
          );
          return;
        }
        const task = items.find(
          (t) => t.status !== "done" && !blocked(job, t, state),
        );
        if (!task) {
          job.status = "needs_attention";
          job.phase = "idle";
          save(job, "可自动推进的任务已处理，其余需要你处理交付清单中的阻塞项");
          return;
        }
        if (job.usedCalls >= job.maxCalls)
          throw fail(
            "已到达本批调用上限；已保留成果。提高总上限并确认恢复，或改为人工处理",
          );
        job.currentTaskId = task.id;
        const rejected =
          task.aiReview &&
          task.aiReview.versionId === task.resultMeta?.id &&
          !task.aiReview.passed;
        const generate = !task.result.trim() || rejected;
        job.phase = generate ? "generate" : "review";
        if (!generate && !task.resultMeta) {
          const context = readInput(job, task.id);
          writeTask(job, context.input, ensureResultMeta);
        }
        const { input } = readInput(job, task.id);
        job.usedCalls++;
        if (generate && rejected) {
          job.reworks ||= {};
          job.reworks[task.id] = (job.reworks[task.id] || 0) + 1;
        }
        save(
          job,
          `${generate ? (rejected ? "返工" : "生成") : "审查"}：${task.title}（调用 ${job.usedCalls}/${job.maxCalls}）`,
        );
        if (!generate) job.progress = { part: 1, parts: 1, phase: "review" };
        const log = await runs.run(
          {
            kind: generate ? "auto-execute" : "auto-review",
            endpoint: "",
            automationId: job.id,
            label:
              `${generate ? "自动交付" : "独立审查"} · ${task.title}`.slice(
                0,
                150,
              ),
            input,
          },
          async (req) => {
            if (generate) {
              const finish = { reason: "" };
              return {
                content: await completeLongForm(
                  completion,
                  generationMessages(input, req),
                  {
                    finishReason: () => finish.reason,
                    onPart: ({ part, parts }) => {
                      if (part > 1) {
                        if (job.usedCalls >= job.maxCalls)
                          throw fail(
                            "续写已到达本批调用上限；当前截断草稿未保存为交付物，原有成果不变。提高总上限并确认恢复，或缩小任务范围",
                          );
                        job.usedCalls++;
                      }
                      job.progress = { part, parts, phase: "generate" };
                      save(
                        job,
                        `撰写第 ${part} 段（最多 ${parts} 次调用）：${task.title}`,
                      );
                      req.run.progress = {
                        label: `正在撰写第 ${part} 段（最多 ${parts} 次调用，非完成百分比）`,
                        part,
                        parts,
                      };
                      req.saveRun();
                    },
                    completion: {
                      maxTokens: 6000,
                      req,
                      config,
                      onFinish: (reason) => {
                        finish.reason = reason;
                      },
                    },
                  },
                ),
                source: "ai",
              };
            }
            const review = reviewMessages(input);
            req.run.sources = review.sources;
            req.saveRun();
            const content = await completion(review.messages, {
              maxTokens: 4000,
              temperature: 0,
              req,
              config,
            });
            req.run.output = { content };
            req.saveRun();
            return { content, assessment: parseReview(content, input.task) };
          },
          control.signal,
        );
        if (closed || control.signal.aborted) break;
        if (generate) {
          writeTask(job, input, (t) => ({
            ...replaceResult(t, log.output.content, "ai", "ai"),
            resultSources: log.sources,
          }));
          job.generations[task.id] = (job.generations[task.id] || 0) + 1;
          save(job, `已保存交付物，准备独立审查：${task.title}`);
        } else {
          const assessment = {
            ...log.output.assessment,
            versionId: input.task.resultMeta.id,
            runId: log.id,
            at: new Date().toISOString(),
            model: log.model,
          };
          writeTask(job, input, (t) => {
            const withReview = { ...t, aiReview: assessment };
            const note = [
              assessment.summary,
              ...assessment.checks
                .filter((c) => !c.passed)
                .map((c) => `${c.criterion}：${c.evidence}`),
            ]
              .join("\n")
              .slice(0, 10000);
            if (assessment.passed && job.mode === "auto")
              return recordReview(withReview, "approved", note, {
                actor: "ai",
                runId: log.id,
              });
            if (!assessment.passed)
              return {
                ...recordReview(withReview, "returned", note, {
                  actor: "ai",
                  runId: log.id,
                }),
                status: "review",
              };
            return { ...withReview, status: "review" };
          });
          save(
            job,
            `${assessment.passed ? "AI 审查通过" : "AI 审查未通过"}：${task.title}`,
          );
        }
      }
      if (!closed) {
        job.status = "paused";
        save(
          job,
          "已暂停自动执行，已有成果保留；未落盘结果可在 AI 执行记录查看",
        );
      }
    } catch (error) {
      if (!closed) {
        job.status = control.signal.aborted ? "paused" : "needs_attention";
        save(
          job,
          control.signal.aborted
            ? "已暂停自动执行，已有成果保留"
            : error.message,
        );
      }
    } finally {
      active.delete(job.projectId);
    }
  }
  async function start(projectId, raw, resume = false) {
    if (!database)
      throw fail(
        "自动执行需要电脑共享数据库，请使用正常启动方式，不支持浏览器独立模式",
      );
    const options = inputSchema.parse(raw);
    const config = await readConfig();
    if (closed) throw fail("服务正在关闭", 503);
    if (isSoftwareActive())
      throw fail("工程交付正在执行，请先停止或等待完成", 409);
    if (!config.apiKey) throw fail("请先在工作台设置中配置 AI 模型");
    if (active.size)
      throw fail("已有项目正在自动执行，请先暂停或等候完成", 409);
    const snapshot = database.read();
    if (snapshot.revision !== options.revision)
      throw fail("工作台已更新，请刷新交付清单后重新确认执行", 409);
    const state = snapshot.state;
    const project = state?.projects.find((p) => p.id === projectId);
    const tasks = state?.tasks.filter((t) => t.projectId === projectId) || [];
    if (!project || project.status !== "active")
      throw fail("请先选择进行中的项目");
    if (project.deliveryType === "software")
      throw fail(
        "此项目需要完整工程，请进入「工程交付」，不要用文档自动执行代替",
      );
    if (!tasks.length || tasks.length > 100)
      throw fail("自动执行支持每个项目 1–100 个任务");
    let job = jobs.get(projectId);
    if (resume) {
      if (!job || !["paused", "needs_attention"].includes(job.status))
        throw fail("当前没有可恢复的执行");
      if (options.maxCalls <= job.usedCalls)
        throw fail("总调用上限必须大于已使用次数");
      if (job.taskIds.some((id) => !tasks.some((t) => t.id === id)))
        throw fail("原任务已删除，请重新启动一批执行");
      Object.assign(job, {
        mode: options.mode,
        maxCalls: options.maxCalls,
        maxReworks: options.maxReworks,
      });
    } else {
      if (tasks.every((t) => t.status === "done"))
        throw fail("任务已全部完成，无需自动执行");
      job = {
        id: randomUUID(),
        projectId,
        taskIds: tasks.map((t) => t.id),
        status: "running",
        phase: "idle",
        currentTaskId: "",
        mode: options.mode,
        maxCalls: options.maxCalls,
        maxReworks: options.maxReworks,
        usedCalls: 0,
        generations: {},
        events: [],
        startedAt: new Date().toISOString(),
      };
    }
    job.status = "running";
    job.title = project.title;
    const controller = new AbortController();
    active.set(projectId, controller);
    try {
      save(
        job,
        resume
          ? "已确认恢复自动执行"
          : "已确认启动：按依赖生成、独立审查、限次返工",
      );
    } catch (error) {
      active.delete(projectId);
      throw error;
    }
    void execute(job, controller, config).catch((error) => {
      active.delete(projectId);
      job.status = "needs_attention";
      job.note = "执行记录无法保存，请检查电脑磁盘空间与权限；请勿反复启动";
      console.error("自动执行持久化失败:", error.message);
    });
    return { ...job };
  }
  return {
    reload: () => {
      if (active.size) throw fail("请先停止执行", 409);
      jobs.clear();
      for (const j of database?.listAutomations() || [])
        jobs.set(j.projectId, j);
    },
    start,
    guardWrite,
    active: () =>
      [...active.keys()].map((id) => {
        const j = jobs.get(id);
        return {
          projectId: id,
          title: j.title,
          status: j.status,
          note: j.note,
          progress: j.progress || null,
        };
      }),
    get: (id) => {
      const snapshot = database?.read();
      const state = snapshot?.state;
      const job = jobs.get(id) || null;
      return {
        job,
        revision: snapshot?.revision || 0,
        project: state?.projects.find((p) => p.id === id) || null,
        tasks:
          state?.tasks
            .filter((t) => t.projectId === id)
            .map((t) => ({
              ...t,
              automationBlock: job
                ? !job.taskIds.includes(t.id)
                  ? "本批未包含此新增任务；请重新启动一批以纳入执行"
                  : blocked(job, t, state)
                : "",
            })) || [],
      };
    },
    pause: (id) => {
      const job = jobs.get(id),
        controller = active.get(id);
      if (controller) {
        job.status = "pausing";
        try {
          save(job, "正在停止当前请求，不再启动下一步");
        } finally {
          controller.abort();
        }
      }
      return { paused: !!controller };
    },
    close: () => {
      for (const [id, c] of active) {
        const j = jobs.get(id);
        j.status = "paused";
        save(j, "电脑服务已停止，等待手动恢复");
        c.abort();
      }
      closed = true;
    },
  };
}
