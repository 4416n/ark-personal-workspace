import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import {
  launchPreview,
  validatePreviewFrame,
  PREVIEW_MAX_LIFETIME_MS,
} from "./preview-sandbox.mjs";
import { sandboxAvailable } from "./project-sandbox.mjs";
import {
  assembleBundle,
  parseBundle,
  sourceFiles,
  sourceHash,
} from "./project-bundle.mjs";
import { requirements, requirementsHash } from "./requirements.mjs";
import { VERIFICATION_VERSION } from "./scaffold/scripts/persistence.mjs";

const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const route = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
const keys = [
  "Tab",
  "Shift+Tab",
  "Enter",
  "Backspace",
  "Delete",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "Escape",
  "Control+A",
];
export const previewActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("click"),
      x: z.number().finite().min(0).max(1279),
      y: z.number().finite().min(0).max(843),
    })
    .strict(),
  z
    .object({ type: z.literal("text"), value: z.string().min(1).max(2000) })
    .strict(),
  z.object({ type: z.literal("key"), key: z.enum(keys) }).strict(),
  z
    .object({
      type: z.literal("scroll"),
      deltaY: z.number().int().min(-800).max(800),
    })
    .strict(),
  z
    .object({
      type: z.literal("viewport"),
      mode: z.enum(["desktop", "mobile"]),
    })
    .strict(),
  ...["frame", "reload", "restart"].map((type) =>
    z.object({ type: z.literal(type) }).strict(),
  ),
]);
const startSchema = z
  .object({
    confirmed: z.literal(true),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export function previewApi(
  app,
  {
    database,
    access,
    idle = () => true,
    launcher = launchPreview,
    capability = sandboxAvailable,
    now = Date.now,
    idleMs = 90000,
    lifetimeMs = PREVIEW_MAX_LIFETIME_MS,
    sweepMs = 1000,
  } = {},
) {
  if (
    !Number.isSafeInteger(idleMs) ||
    idleMs < 1 ||
    idleMs > 90000 ||
    !Number.isSafeInteger(lifetimeMs) ||
    lifetimeMs < 1 ||
    lifetimeMs > PREVIEW_MAX_LIFETIME_MS
  )
    throw new Error("无效预览时限");
  let current = null,
    closed = false;
  const owner = (req) =>
    access.local(req)
      ? "local"
      : createHash("sha256")
          .update(req.headers.cookie || "")
          .digest("hex");
  const view = (session) => ({
    id: session.id,
    buildId: session.buildId,
    sourceHash: session.sourceHash,
    expiresAt: session.expiresAt,
    idleExpiresAt: session.lastActionAt + idleMs,
    status: session.transport ? "running" : "starting",
    frame: session.frame,
  });
  const stop = (session = current) => {
    if (!session) return Promise.resolve();
    if (session.stopping) return session.stopping;
    session.control.abort();
    session.stopping = (async () => {
      // Await a launch that has not yet returned so cancellation cannot leak a late service.
      if (session.starting) await session.starting.catch(() => {});
      if (session.cleanup) await session.cleanup();
      else await session.transport?.close();
      if (current === session) current = null;
    })().catch((error) => {
      session.stopping = null;
      throw error;
    });
    return session.stopping;
  };
  const expired = (session) =>
    now() >= session.expiresAt ||
    now() >= session.lastActionAt + idleMs ||
    (session.transport && !session.transport.alive());
  const get = async (req) => {
    const session = current;
    if (
      !session ||
      session.id !== req.params.id ||
      session.owner !== owner(req)
    )
      throw fail("预览不存在或不属于当前设备会话", 404);
    if (session.stopping || expired(session)) {
      await stop(session);
      throw fail("预览已结束，请重新启动", 410);
    }
    return session;
  };
  const buildFor = (id, expectedHash) => {
    if (!database) throw fail("安全预览需要电脑共享工作台");
    const build = database.getBuild(id);
    if (!build?.files?.length) throw fail("工程版本不存在或没有完整源码", 404);
    if (
      build.status !== "verified" ||
      build.validation?.passed !== true ||
      build.validation.verificationVersion !== VERIFICATION_VERSION ||
      build.validation.sourceHash !== build.sourceHash ||
      sourceHash(build.files) !== build.sourceHash
    )
      throw fail("请先对当前源码完成真实隔离验证，再开启安全预览", 409);
    if (build.sourceHash !== expectedHash)
      throw fail("工程源码已变化，请重新确认", 409);
    const state = database.read().state;
    if (
      !state?.projects.some((project) => project.id === build.projectId) ||
      requirementsHash(
        requirements(state, build.projectId),
        build.requirementsVersion || 1,
      ) !== build.requirementsHash
    )
      throw fail("工程对应的需求已过期，请先生成并验证当前需求版本", 409);
    return build;
  };
  const timer = setInterval(() => {
    if (current && expired(current)) void stop().catch(() => {});
  }, sweepMs);
  timer.unref?.();
  app.get(
    "/api/software-builds/:id/preview",
    route(async (req, res) => {
      if (current && expired(current)) await stop();
      res.json({
        session:
          current &&
          current.buildId === req.params.id &&
          current.owner === owner(req)
            ? view(current)
            : null,
        occupied: !!current,
      });
    }),
  );
  app.post(
    "/api/software-builds/:id/preview",
    route(async (req, res) => {
      if (closed) throw fail("服务正在关闭", 503);
      const options = startSchema.parse(req.body);
      if (current && expired(current)) await stop();
      if (current || !idle())
        throw fail("请先停止其他预览或工程执行，再开启安全预览", 409);
      const build = buildFor(req.params.id, options.sourceHash);
      const session = {
        id: randomUUID(),
        owner: owner(req),
        buildId: build.id,
        projectId: build.projectId,
        sourceHash: build.sourceHash,
        requirementsHash: build.requirementsHash,
        requirementsVersion: build.requirementsVersion || 1,
        expiresAt: now() + lifetimeMs,
        lastActionAt: now(),
        control: new AbortController(),
        frame: null,
        transport: null,
        busy: false,
      };
      current = session; // Reserve before the first await; model execution observes this lock.
      session.starting = (async () => {
        const available = await capability();
        if (!available.available) throw fail(available.reason, 503);
        session.control.signal.throwIfAborted();
        // Rebuild fixed platform scripts locally; never execute backup-provided harness content.
        const bundle = parseBundle(
          JSON.stringify({
            summary: build.summary || "已验证工程",
            files: sourceFiles(build.files),
            tests: JSON.parse(
              build.files.find((file) => file.path === "tests/acceptance.json")
                ?.content || "null",
            ),
          }),
          { requirePersistence: true },
        );
        const files = await assembleBundle(bundle);
        // The declarative JSON was validated above; preserve its bytes to retain the
        // original verified source hash even if object key order differs.
        files.find((file) => file.path === "tests/acceptance.json").content =
          build.files.find(
            (file) => file.path === "tests/acceptance.json",
          ).content;
        if (sourceHash(files) !== build.sourceHash)
          throw fail("运行脚本已更新，请先重新验证此工程", 409);
        const transport = await launcher(files, {
          signal: session.control.signal,
          onCleanup: (cleanup) => {
            session.cleanup = cleanup;
          },
        });
        session.transport = transport;
        session.control.signal.throwIfAborted();
        buildFor(build.id, options.sourceHash);
        session.frame = validatePreviewFrame(transport.frame);
        return view(session);
      })();
      try {
        res.json(await session.starting);
      } catch (error) {
        await stop(session);
        throw error;
      }
    }),
  );
  app.post(
    "/api/previews/:id/action",
    route(async (req, res) => {
      const action = previewActionSchema.parse(req.body);
      const session = await get(req);
      if (!session.transport || session.busy)
        throw fail("请等待上一项预览操作完成", 409);
      if (
        action.type === "click" &&
        (action.x >= session.frame.width || action.y >= session.frame.height)
      )
        throw fail("点击超出预览画面");
      session.busy = true;
      if (action.type !== "frame") session.lastActionAt = now();
      try {
        session.frame = validatePreviewFrame(
          await session.transport.request(action),
        );
        if (current !== session || session.stopping)
          throw fail("预览已停止", 410);
        res.json(view(session));
      } catch (error) {
        await stop(session);
        throw error;
      } finally {
        session.busy = false;
      }
    }),
  );
  app.delete(
    "/api/previews/:id",
    route(async (req, res) => {
      const session = await get(req);
      await stop(session);
      res.json({ ok: true });
    }),
  );
  return {
    active: () =>
      current
        ? { buildId: current.buildId, projectId: current.projectId }
        : null,
    guardWrite(next) {
      if (
        current &&
        (!next.projects.some((project) => project.id === current.projectId) ||
          requirementsHash(
            requirements(next, current.projectId),
            current.requirementsVersion,
          ) !== current.requirementsHash)
      )
        throw fail("请先停止安全预览，再修改该项目需求或删除项目", 423);
    },
    close() {
      closed = true;
      clearInterval(timer);
      return stop();
    },
  };
}
