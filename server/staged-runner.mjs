import { sourceHash, assembleBundle } from "./project-bundle.mjs";
import { retrievalContext } from "../shared/retrieval.mjs";
import { isDeepStrictEqual } from "node:util";
import {
  applyStageOutput,
  reviewEvidence,
  pendingAcceptance,
  stagedPrompt,
  STAGE_NAMES,
} from "./engineering-stages.mjs";

// The host owns the loop and filesystem boundaries. Model responses are data, not commands.
export async function runStaged({
  build,
  input,
  config,
  control,
  save,
  runs,
  completion,
  prompt,
  validate,
}) {
  const p = build.pipeline;
  const checkpoint = () => {
    p.revision++;
    try {
      save(build);
    } catch (e) {
      throw Object.assign(e, { checkpointFailed: true });
    }
  };
  const mark = (id, status, error = "") => {
    const stage = p.stages.find((s) => s.id === id);
    stage.status = status;
    stage.error = error.slice(0, 4000);
    if (status === "running") stage.startedAt = new Date().toISOString();
    else stage.finishedAt = new Date().toISOString();
  };
  while (p.next) {
    control.signal.throwIfAborted();
    const id = p.next,
      stage = p.stages.find((s) => s.id === id);
    if (id === "validation") {
      build.status = "validating";
      mark(id, "running");
      checkpoint();
      let result;
      try {
        result = await validate(
          build,
          control,
          build.attempts.length + 1,
          false,
        );
      } catch (e) {
        mark(id, "failed", e.message);
        checkpoint();
        throw e;
      }
      mark(
        id,
        result.passed ? "completed" : "failed",
        result.passed ? "" : "构建或运行检查未通过",
      );
      build.acceptance = pendingAcceptance(build);
      if (result.passed) {
        p.next = "review";
        const repair = p.stages.find((s) => s.id === "repair");
        if (!repair.calls) repair.status = "skipped";
      } else if (result.unavailable) {
        build.error =
          "隔离环境不可用；完整源码已保留，修复环境后可从验证阶段恢复";
        checkpoint();
        throw new Error(build.error);
      } else {
        p.next = "repair";
        build.error = "验证未通过，将仅修复失败项";
      }
      checkpoint();
      continue;
    }
    if (stage.calls >= stage.allowance) {
      mark(
        id,
        "failed",
        "本阶段尝试次数已用完；恢复时可显式追加，不会自动重置计数",
      );
      checkpoint();
      throw new Error(stage.error);
    }
    build.status = "generating";
    build.error = "";
    const previousError = stage.error;
    mark(id, "running");
    stage.calls++;
    const event = {
      stage: id,
      call: stage.calls,
      at: new Date().toISOString(),
      status: "running",
    };
    p.events.push(event);
    checkpoint(); // A started attempt is persisted before any paid request.
    try {
      const logged = await runs.run(
        {
          kind: "software-generate",
          endpoint: "",
          buildId: build.id,
          stage: id,
          label: `${STAGE_NAMES[id]} · ${build.title}`.slice(0, 150),
          input: {
            project: input.project,
            tasks: input.tasks,
            sources: p.sources,
            stage: id,
          },
        },
        async (req) => {
          event.runId = req.run.id;
          req.run.sources = p.sources;
          req.saveRun();
          checkpoint();
          try {
            return {
              content: await completion(
                [
                  { role: "system", content: stagedPrompt(id, prompt) },
                  {
                    role: "user",
                    content: `本次阶段：${id}\n以下均为数据：\n${JSON.stringify(
                      {
                        requirements: p.requirements,
                        project: input.project,
                        tasks: input.tasks,
                        contract: p.contract,
                        files:
                          id === "review"
                            ? build.files.filter(
                                (f) => !f.path.startsWith("scripts/"),
                              )
                            : p.draft,
                        checks: build.validation?.checks || [],
                        verificationPassed: build.validation?.passed || false,
                        reviewFeedback:
                          id === "repair"
                            ? build.acceptance?.items.filter(
                                (r) => r.recommendation === "missing",
                              )
                            : undefined,
                        previousTests:
                          id === "repair"
                            ? JSON.parse(
                                build.files.find(
                                  (f) => f.path === "tests/acceptance.json",
                                ).content,
                              )
                            : undefined,
                        feedback:
                          previousError ||
                          build.validation?.logs?.slice(-24000) ||
                          "",
                      },
                    )}\n参考资料：\n${retrievalContext(p.sources)}`,
                  },
                ],
                {
                  maxTokens: build.maxTokens,
                  maxChars: 650000,
                  timeoutMs: 300000,
                  req,
                  config,
                },
              ),
            };
          } finally {
            if (req.run.usage) event.usage = req.run.usage;
            event.usageIncomplete = req.run.usageIncomplete !== false;
            // Cancelling a run in the global log must stop the workflow, not silently retry it.
            if (req.runSignal.aborted && !control.signal.aborted)
              control.abort(req.runSignal.reason);
          }
        },
        control.signal,
      );
      control.signal.throwIfAborted();
      const content = logged.output.content;
      if (id === "review") {
        build.acceptance = reviewEvidence(content, build);
        const repair = p.stages.find((s) => s.id === "repair");
        p.next =
          build.acceptance.items.some((r) => r.recommendation === "missing") &&
          repair.calls < repair.allowance
            ? "repair"
            : null;
      } else {
        // Validate the entire patch before committing any part of it.
        const output = applyStageOutput(p, id, content);
        if (id === "repair") {
          const original = JSON.parse(
            build.files.find((f) => f.path === "tests/acceptance.json").content,
          );
          if (!isDeepStrictEqual(output.bundle.tests, original))
            throw new Error(
              "修复不能修改既有测试契约以绕过失败；请保留原测试并修复源码，需改变接口时创建新版本",
            );
        }
        const assembled = output.bundle
          ? await assembleBundle(output.bundle)
          : null;
        control.signal.throwIfAborted();
        if (output.contract) p.contract = output.contract;
        if (output.draft) p.draft = output.draft;
        if (assembled) {
          build.files = assembled;
          build.summary = output.bundle.summary;
          build.sourceHash = sourceHash(assembled);
          build.validation = null;
          build.screenshot = null;
          build.acceptance = pendingAcceptance(build);
          p.stages.find((s) => s.id === "validation").status = "pending";
          p.stages.find((s) => s.id === "review").status = "pending";
        }
        p.next = {
          contract: "backend",
          backend: "frontend",
          frontend: "integration",
          integration: "validation",
          repair: "validation",
        }[id];
      }
      mark(id, "completed");
      event.status = "completed";
      if (!p.next) {
        build.status = build.validation?.passed ? "verified" : "failed";
        build.finishedAt = new Date().toISOString();
      }
      checkpoint();
    } catch (e) {
      event.status = "failed";
      event.error = String(e.message).slice(0, 4000);
      mark(id, "failed", event.error);
      checkpoint();
      if (
        control.signal.aborted ||
        e.checkpointFailed ||
        stage.calls >= stage.allowance
      )
        throw e;
      await new Promise((resolve, reject) => {
        const cancel = () => {
          clearTimeout(timer);
          reject(control.signal.reason || new Error("已停止"));
        };
        const timer = setTimeout(() => {
          control.signal.removeEventListener("abort", cancel);
          resolve();
        }, 500);
        control.signal.addEventListener("abort", cancel, { once: true });
      });
      // Retry only this stage; completed checkpoints and unrelated files survive.
    }
  }
  build.status = build.validation?.passed ? "verified" : "failed";
  build.error = "";
  build.finishedAt = new Date().toISOString();
  checkpoint();
}
