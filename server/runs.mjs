import { randomUUID } from "node:crypto";
export function executionLog(database) {
  let closed = false;
  const memory = new Map();
  const controllers = new Map();
  const list = () =>
    database ? database.listRuns() : [...memory.values()].reverse();
  const save = (r) => {
    if (closed) return;
    if (database) database.saveRun(r);
    else {
      memory.set(r.id, r);
      if (memory.size > 100) memory.delete(memory.keys().next().value);
    }
  };
  const get = (id) => list().find((r) => r.id === id);
  function track(kind, handler) {
    return async (req, res, next) => {
      if (kind === "plan" && req.body.mode === "local")
        return Promise.resolve(handler(req, res)).catch(next);
      if (controllers.size >= 3)
        return res
          .status(429)
          .json({ error: "已有 3 项 AI 任务执行中，请稍后再试" });
      const requested = req.get("X-Run-Id");
      const id =
        /^[a-f0-9-]{36}$/.test(requested || "") && !get(requested)
          ? requested
          : randomUUID();
      const controller = new AbortController();
      const run = {
        id,
        kind,
        endpoint: req.path.replace(/^\/api/, ""),
        input: req.body,
        label: (
          req.body.task?.title ||
          req.body.goal ||
          req.body.messages?.at(-1)?.content ||
          "模型连接测试"
        ).slice(0, 150),
        startedAt: new Date().toISOString(),
        status: "running",
        sources: [],
      };
      req.run = run;
      req.runSignal = controller.signal;
      req.saveRun = () => save(run);
      controllers.set(id, controller);
      save(run);
      const json = res.json.bind(res);
      res.json = (value) => {
        if (run.status === "running") {
          run.status = "succeeded";
          run.output = value;
          run.finishedAt = new Date().toISOString();
          save(run);
        }
        return json({ ...value, runId: id, sources: run.sources });
      };
      try {
        await handler(req, res);
      } catch (error) {
        run.status = controller.signal.aborted ? "cancelled" : "failed";
        run.error = controller.signal.aborted ? "已取消生成" : error.message;
        run.finishedAt = new Date().toISOString();
        save(run);
        res.json = json;
        next(Object.assign(error, { message: run.error }));
      } finally {
        controllers.delete(id);
      }
    };
  }
  return {
    close: () => {
      for (const [id, controller] of controllers) {
        controller.abort();
        const run = get(id);
        if (run?.status === "running")
          save({
            ...run,
            status: "cancelled",
            error: "电脑服务已停止",
            finishedAt: new Date().toISOString(),
          });
      }
      closed = true;
    },
    // Background calls share the same concurrency budget and audit log as UI calls.
    run: async (meta, handler, signal) => {
      if (controllers.size >= 3)
        throw new Error("已有 3 项 AI 任务执行中，请稍后恢复自动执行");
      const controller = new AbortController();
      const run = {
        ...meta,
        id: randomUUID(),
        startedAt: new Date().toISOString(),
        status: "running",
        sources: [],
      };
      controllers.set(run.id, controller);
      try {
        save(run);
        const context = {
          run,
          runSignal: signal
            ? AbortSignal.any([signal, controller.signal])
            : controller.signal,
          saveRun: () => save(run),
        };
        context.runSignal.throwIfAborted();
        const output = await handler(context);
        context.runSignal.throwIfAborted();
        Object.assign(run, {
          status: "succeeded",
          output,
          finishedAt: new Date().toISOString(),
        });
        save(run);
        return run;
      } catch (error) {
        Object.assign(run, {
          status:
            signal?.aborted || controller.signal.aborted
              ? "cancelled"
              : "failed",
          error:
            signal?.aborted || controller.signal.aborted
              ? "已取消生成"
              : error.message,
          finishedAt: new Date().toISOString(),
        });
        save(run);
        throw error;
      } finally {
        controllers.delete(run.id);
      }
    },
    track,
    list,
    get,
    cancel: (id) => {
      const c = controllers.get(id);
      c?.abort();
      return !!c;
    },
  };
}
