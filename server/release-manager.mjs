import { randomUUID } from "node:crypto";
import { privateStore } from "./autopilot-store.mjs";
import { sourceHash } from "./project-bundle.mjs";

const fail = (message) => { throw new Error(message); };
const managedName = (value) => /^ark-auto-[a-z0-9-]{1,100}$/.test(value || "");

export function releaseManager({ directory, runtime, firstPort = 8800, monitorMs = 15000, publicUrl, publisher, fetcher = fetch } = {}) {
  if (!Number.isInteger(firstPort) || firstPort < 1024 || firstPort > 65000) fail("自动部署起始端口必须在 1024–65000 之间");
  const store = privateStore(directory, "autopilot-releases.json", { version: 1, apps: [] });
  let data = store.read(), busy = false, closed = false, monitoring = false;
  if (data.version !== 1 || !Array.isArray(data.apps)) fail("自动部署记录格式无效");
  const save = () => store.write(data);
  const event = (app, text) => {
    app.events = [{ at: new Date().toISOString(), text }, ...(app.events || [])].slice(0, 100);
    save();
  };
  const command = (args, options) => runtime.command(args, options);
  const retainFailed = (app, release) => {
    if (app.failed && app.failed.id !== release.id)
      app.archived = [...(app.archived || []), app.failed];
    app.failed = release;
  };
  const inspect = async (name) => {
    if (!managedName(name)) fail("部署记录包含非受管容器");
    return JSON.parse(await command(["inspect", name], { timeout: 10000 }))[0];
  };
  async function stop(release) {
    if (!release) return;
    try { await command(["stop", "--time=10", release.container], { timeout: 20000 }); }
    catch (error) {
      if (!/No such container|No such object/i.test(error.message)) throw error;
    }
  }
  async function restart(release) {
    if (!release) return;
    await command(["start", release.container], { timeout: 20000 });
    await runtime.health(release.localUrl);
  }
  async function rollback(app, reason) {
    const previous = app.previous;
    if (!previous) {
      app.status = "unhealthy"; app.error = reason;
      event(app, "当前版本健康检查失败，尚无可回滚版本；保留数据和日志");
      return false;
    }
    app.status = "rolling-back"; app.error = reason; save();
    try { await stop(app.current); await restart(previous); }
    catch (error) {
      app.status = "rollback-failed"; app.error = error.message;
      event(app, "回滚未成功，保留两个版本的数据，需要修复运行环境");
      throw error;
    }
    retainFailed(app, app.current);
    app.current = previous;
    app.previous = null;
    app.pending = null;
    app.status = "rolled-back";
    event(app, `已自动回滚：${reason}；失败版数据卷保留供恢复`);
    return true;
  }
  async function recoverPending(app) {
    const pending = app.pending;
    await runtime.removeContainer(pending.container);
    if (app.current) {
      await restart(app.current);
      app.status = "rolled-back";
      app.error = "未完成的发布已恢复上一版本";
    } else {
      app.status = "failed"; app.error = "首次部署中断，可自动重试";
    }
    retainFailed(app, pending);
    app.pending = null;
    event(app, app.error);
  }
  async function recover() {
    if (busy || monitoring) fail("部署服务正忙");
    busy = true;
    try { for (const app of data.apps) {
      if (!app.pending) {
        if (app.status === "rolling-back" || app.status === "rollback-failed")
          await rollback(app, "服务重启后继续未完成的回滚");
        continue;
      }
      await recoverPending(app);
    } } finally { busy = false; }
    return true;
  }
  async function deploy(projectId, build, { signal } = {}) {
    if (busy || monitoring || closed) fail("部署服务正在执行或关闭");
    busy = true;
    let app, release;
    try {
      signal?.throwIfAborted();
      if (!build.validation?.passed || build.validation.sourceHash !== build.sourceHash || sourceHash(build.files) !== build.sourceHash)
        fail("只有实际通过验证、源码一致的工程可以自动发布");
      app = data.apps.find((item) => item.projectId === projectId);
      if (app?.pending) await recoverPending(app);
      if (app?.current?.sourceHash === build.sourceHash) {
        await runtime.health(app.current.localUrl, { signal });
        return structuredClone(app);
      }
      if (!app) {
        if (data.apps.length >= 100) fail("自动部署最多管理 100 个应用");
        const used = new Set(data.apps.map((item) => item.port));
        let port = firstPort;
        while (used.has(port)) port++;
        app = { projectId, port, status: "preparing", current: null, previous: null, events: [] };
        data.apps.push(app); save();
      }
      const id = randomUUID();
      release = { id, buildId: build.id, sourceHash: build.sourceHash, image: `ark-auto-app-${id}`, container: `ark-auto-app-${id}`, volume: `ark-auto-data-${id}`, network: `ark-auto-net-${id}`, localUrl: `http://127.0.0.1:${app.port}`, createdAt: new Date().toISOString() };
      app.pending = release; app.status = "building"; app.error = "";
      event(app, "构建生产镜像，保留当前在线版本");
      if (runtime.prepareImage) await runtime.prepareImage(build.files, release.image, build.validation, signal);
      else await runtime.buildImage(build.files, release.image, signal);
      await runtime.network(release.network, signal);
      app.status = "switching"; event(app, "停止旧版并复制一致的数据卷到新版本");
      await stop(app.current);
      await runtime.createVolume(release.volume, release.image, app.current?.volume, signal);
      signal?.throwIfAborted();
      await runtime.startContainer({ name: release.container, image: release.image, volume: release.volume, network: release.network, port: app.port, signal });
      app.status = "checking"; event(app, "检查新版本健康状态和业务读取接口");
      await runtime.health(release.localUrl, { signal });
      const persistence = JSON.parse(build.files.find((file) => file.path === "tests/acceptance.json").content).persistence;
      const read = await fetcher(release.localUrl + persistence.read.path, { redirect: "error", signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(5000)]) });
      if (read.status !== persistence.read.status) fail("生产版本业务读取检查失败");
      const publishedUrl = publisher ? await publisher.publish(projectId, app.port) : null;
      if (publishedUrl) await runtime.health(publishedUrl, { signal });
      signal?.throwIfAborted();
      app.archived = [...(app.archived || []), ...(app.previous ? [app.previous] : [])];
      app.previous = app.current; app.current = release; app.pending = null;
      app.status = "live"; app.failures = 0; app.error = "";
      app.url = publishedUrl || (publicUrl ? publicUrl.replace("{project}", projectId) : release.localUrl);
      event(app, "部署成功，已开启定时健康检查与失败回滚");
      return structuredClone(app);
    } catch (error) {
      if (app && release) {
        await runtime.removeContainer(release.container);
        try { await restart(app.current); }
        catch (recoveryError) {
          app.status = "rollback-failed"; app.error = `${error.message}；旧版恢复失败：${recoveryError.message}`;
          event(app, app.error);
          throw new Error(app.error);
        }
        retainFailed(app, release); app.pending = null;
        app.status = app.current ? "rolled-back" : "failed"; app.error = error.message;
        event(app, app.current ? `部署未成功，已恢复旧版：${error.message}` : `首次部署失败：${error.message}`);
      }
      throw error;
    } finally { busy = false; }
  }
  async function monitor() {
    if (busy || closed || monitoring) return;
    monitoring = true;
    try {
      for (const app of data.apps) {
        if (app.pending) {
          try { await recoverPending(app); }
          catch (error) { app.error = error.message; save(); }
          continue;
        }
        if (!app.pending && ["rolling-back", "rollback-failed"].includes(app.status) && app.previous) {
          try { await rollback(app, "自动重试未完成的回滚"); } catch {}
          continue;
        }
        if (!app.current || !["live", "rolled-back", "unhealthy"].includes(app.status)) continue;
        try {
          const container = await inspect(app.current.container);
          if (!container.State?.Running) fail("应用容器未运行");
          await runtime.health(app.current.localUrl, { attempts: 1 });
          if (app.url && app.url !== app.current.localUrl) await runtime.health(app.url, { attempts: 1 });
          app.failures = 0;
          if (app.status === "unhealthy") { app.status = "live"; app.error = ""; event(app, "健康检查恢复正常"); }
        } catch (error) {
          app.failures = (app.failures || 0) + 1;
          if (app.failures >= 3 && app.status !== "unhealthy") {
            busy = true;
            try { await rollback(app, error.message); }
            catch {} finally { busy = false; }
          }
        }
      }
      save();
    } finally { monitoring = false; }
  }
  const timer = setInterval(() => void monitor().catch(() => {}), monitorMs);
  timer.unref?.();
  return {
    recover, deploy, monitor,
    list: () => structuredClone(data.apps),
    active: () => busy || monitoring,
    async rollback(projectId) {
      if (busy || monitoring || closed) fail("部署服务正忙");
      const app = data.apps.find((item) => item.projectId === projectId);
      if (!app?.previous) fail("没有可回滚的上一版本");
      busy = true;
      try { await rollback(app, "用户选择回滚"); return structuredClone(app); }
      finally { busy = false; }
    },
    close() { closed = true; clearInterval(timer); },
  };
}
