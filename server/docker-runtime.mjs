import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { materialize, sourceHash } from "./project-bundle.mjs";
import { assertDynamicTests, substitute, VERIFICATION_VERSION } from "./scaffold/scripts/persistence.mjs";

export function dockerCommand(args, { signal, timeout = 120000, limit = 1000000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", bytes = 0, failure;
    const stop = () => { failure ||= new Error("Docker 操作已取消或超时"); child.kill(); };
    const timer = setTimeout(stop, timeout);
    const capture = (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) { failure = new Error("Docker 输出超过限制"); stop(); }
      else output += chunk.toString();
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    child.once("error", (error) => { failure = error; });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      if (failure || code !== 0)
        reject(failure || new Error(`Docker 操作失败：${output.slice(-4000)}`));
      else resolve(output.trim());
    });
  });
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const identifier = (value) => {
  if (!/^ark-auto-[a-z0-9-]{1,100}$/.test(value)) throw new Error("无效的受管 Docker 资源名称");
  return value;
};
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const options = (volume) => [
  "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true", "--pids-limit=128",
  "--memory=512m", "--memory-swap=512m", "--cpus=1", "--tmpfs=/tmp:rw,noexec,nosuid,size=64m",
  "--mount", `type=volume,src=${identifier(volume)},dst=/app/data`,
];

export function dockerRuntime({ command = dockerCommand, fetcher = fetch, browserFactory } = {}) {
  const call = (args, settings) => command(args, settings);
  async function capability() {
    try {
      const version = await call(["info", "--format", "{{.OSType}}"], { timeout: 10000 });
      expect(version === "linux", "需要启用 Linux 容器的 Docker Engine");
      if (!browserFactory) {
        const { chromium } = await import("@playwright/test");
        await fs.access(chromium.executablePath());
      }
      return { available: true, driver: "docker", reason: "Docker Linux 容器可用；生成后端在受限容器运行，页面由受控 Chromium 验证" };
    } catch (error) {
      return { available: false, driver: "docker", reason: `全自动执行需要 Docker Linux 容器：${error.message}` };
    }
  }
  async function buildImage(files, image, signal) {
    identifier(image);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-autobuild-"));
    try {
      await materialize(directory, files);
      await call(["build", "--label", "ark.autopilot=1", "--label", `ark.source=${sourceHash(files)}`, "--tag", image, directory], { signal, timeout: 300000 });
    } finally {
      const target = path.resolve(directory);
      expect(path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith("ark-autobuild-"), "临时目录边界检查失败");
      await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
  async function createVolume(name, image, from, signal) {
    identifier(name);
    await call(["volume", "create", "--label", "ark.autopilot=1", name], { signal });
    await call(["run", "--rm", "--network=none", "--read-only", "--cap-drop=ALL", "--cap-add=CHOWN", "--user=0:0", "--label", "ark.autopilot=1", "--mount", `type=volume,src=${name},dst=/app/data`, "--entrypoint=node", identifier(image), "--input-type=module", "-e", "const fs=await import('node:fs/promises');await fs.chown('/app/data',1000,1000);"], { signal, timeout: 60000 });
    if (from) await call(["run", "--rm", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true", "--user=1000:1000", "--label", "ark.autopilot=1", "--mount", `type=volume,src=${name},dst=/app/data`, "--mount", `type=volume,src=${identifier(from)},dst=/previous,readonly`, "--entrypoint=node", image, "--input-type=module", "-e", "const fs=await import('node:fs/promises');await fs.cp('/previous','/app/data',{recursive:true,verbatimSymlinks:true});"], { signal, timeout: 60000 });
  }
  async function startContainer({ name, image, volume, network, port = 0, signal }) {
    await call(["run", "--detach", "--name", identifier(name), "--label", "ark.autopilot=1", "--restart=unless-stopped", ...options(volume), "--network", identifier(network), "--publish", `127.0.0.1:${port}:8080`, identifier(image)], { signal });
    const output = await call(["port", name, "8080/tcp"], { signal });
    const actualPort = Number(/127\.0\.0\.1:(\d+)/.exec(output)?.[1]);
    expect(actualPort > 0, "无法确定部署端口");
    return `http://127.0.0.1:${actualPort}`;
  }
  async function health(url, { signal, attempts = 40 } = {}) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      signal?.throwIfAborted();
      try {
        const response = await fetcher(url + "/healthz", { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(2000)]) : AbortSignal.timeout(2000), redirect: "error" });
        if (response.ok && (await response.json()).ok === true) return true;
      } catch {}
      await sleep(250);
    }
    throw new Error("部署健康检查未通过");
  }
  async function removeContainer(name) {
    try { await call(["rm", "--force", identifier(name)], { timeout: 20000 }); }
    catch (error) {
      if (!/No such container|No such object/i.test(error.message)) throw error;
    }
  }
  async function network(name, signal) {
    await call(["network", "create", "--internal", "--label", "ark.autopilot=1", identifier(name)], { signal });
  }
  async function sqliteEvidence(image, volume, storage, value, signal) {
    const script = `import {sqliteContains} from './scripts/persistence.mjs';const found=await sqliteContains('/app/data',${JSON.stringify([value])},${JSON.stringify(storage)});console.log('ARK_SQLITE_EVIDENCE='+JSON.stringify([...found]));`;
    const output = await call(["run", "--rm", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true", "--memory=256m", "--pids-limit=32", "--mount", `type=volume,src=${identifier(volume)},dst=/app/data,readonly`, "--entrypoint=node", identifier(image), "--input-type=module", "-e", script], { signal, timeout: 20000 });
    const line = output.split("\n").find((entry) => entry.startsWith("ARK_SQLITE_EVIDENCE="));
    expect(!!line, "缺少可信 SQLite 检查结果");
    return JSON.parse(line.slice("ARK_SQLITE_EVIDENCE=".length)).includes(value);
  }
  async function validate(files, { signal } = {}) {
    const ready = await capability();
    if (!ready.available) return { passed: false, unavailable: true, checks: [], logs: ready.reason };
    const prefix = `ark-auto-check-${randomUUID()}`;
    const image = prefix, volume = prefix, name = prefix, net = prefix;
    const report = { passed: false, verificationVersion: VERIFICATION_VERSION, driver: "docker", scope: "Docker 生产镜像、声明接口、随机 SQLite 落库与重启读回、浏览器表单及 390px 手机布局；修改/删除只在声明后覆盖。", checks: [], logs: "", coverage: { update: false, remove: false, browser: false } };
    let browser, createdNetwork = false, createdVolume = false;
    const check = async (label, action) => {
      try { await action(); report.checks.push({ name: label, passed: true, detail: "通过" }); }
      catch (error) { report.checks.push({ name: label, passed: false, detail: error.message }); throw error; }
    };
    try {
      const tests = JSON.parse(files.find((file) => file.path === "tests/acceptance.json").content);
      assertDynamicTests(tests);
      await check("Docker 生产镜像构建", () => buildImage(files, image, signal));
      await network(net, signal); createdNetwork = true;
      createdVolume = true; await createVolume(volume, image, null, signal);
      const base = await startContainer({ name, image, volume, network: net, signal });
      await check("容器启动与健康检查", () => health(base, { signal }));
      const request = async (spec, values = {}) => {
        const response = await fetcher(base + substitute(spec.path, values), {
          method: spec.method, headers: { "Content-Type": "application/json" },
          body: spec.body === undefined ? undefined : JSON.stringify(substitute(spec.body, values)),
          signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(5000)]), redirect: "error",
        });
        expect(response.status === spec.status, `${spec.method} ${spec.path} 返回 ${response.status}，预期 ${spec.status}`);
        const text = await response.text();
        expect(text.length <= 1000000, "验收响应超过限制");
        return text;
      };
      for (const item of tests.api)
        await check(`接口：${item.name}`, async () => expect((await request(item)).includes(item.contains), "接口缺少预期内容"));
      const persistence = tests.persistence;
      const value = `ark_${randomUUID().replaceAll("-", "")}`;
      let recordId = "";
      const restartEvidence = async (present, absent) => {
        await call(["stop", "--time=5", name], { signal });
        if (present) expect(await sqliteEvidence(image, volume, persistence.storage, present, signal), "随机业务数据没有实际写入 SQLite");
        if (absent) expect(!await sqliteEvidence(image, volume, persistence.storage, absent, signal), "SQLite 仍包含已更新或删除的值");
        await call(["start", name], { signal });
        await health(base, { signal });
        const text = await request(persistence.read);
        if (present) expect(text.includes(present), "重启后无法读取随机业务数据");
        if (absent) expect(!text.includes(absent), "重启后仍返回已删除或更新的数据");
      };
      await check("随机创建、SQLite 落库和重启读回", async () => {
        const created = await request(persistence.create, { value });
        if (persistence.idPointer) {
          let id = JSON.parse(created);
          for (const segment of persistence.idPointer.slice(1).split("/")) id = id?.[segment];
          expect((typeof id === "string" || Number.isSafeInteger(id)) && /^[A-Za-z0-9_-]{1,100}$/.test(String(id)), "创建响应没有有效业务 ID");
          recordId = String(id);
        }
        await restartEvidence(value);
      });
      let current = value;
      if (persistence.update) await check("随机更新、落库与重启读回", async () => {
        const updated = `ark_${randomUUID().replaceAll("-", "")}`;
        await request(persistence.update, { id: recordId, value: updated });
        await restartEvidence(updated, current);
        current = updated; report.coverage.update = true;
      });
      if (persistence.remove) await check("删除与重启验证", async () => {
        await request(persistence.remove, { id: recordId });
        await restartEvidence(null, current); report.coverage.remove = true;
      });
      await check("浏览器真实表单、重启与手机布局", async () => {
        browser = browserFactory ? await browserFactory() : await (await import("@playwright/test")).chromium.launch({ headless: true, chromiumSandbox: true, args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"] });
        const createContext = async (width, height) => {
          const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", acceptDownloads: false });
          await context.routeWebSocket("**/*", (socket) => socket.close());
          await context.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
          return context;
        };
        let context = await createContext(1280, 800);
        const errors = [];
        const prepare = async () => {
          const page = await context.newPage();
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(base, { waitUntil: "networkidle", timeout: 15000 });
          return page;
        };
        let page = await prepare();
        const browserValue = `ark_browser_${randomUUID().replaceAll("-", "")}`;
        for (const step of substitute(tests.browser, { browserValue })) {
          if (step.action === "fill") await page.locator(step.selector).fill(step.value, { timeout: 5000 });
          if (step.action === "click") await page.locator(step.selector).click({ timeout: 5000 });
          if (step.action === "text") await page.getByText(step.value).first().waitFor({ timeout: 5000 });
        }
        await context.close();
        await restartEvidence(browserValue);
        context = await createContext(390, 844);
        page = await prepare();
        await page.getByText(browserValue).first().waitFor({ timeout: 5000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "手机页面横向溢出");
        expect(errors.length === 0, errors.join("\n"));
        report.screenshot = (await page.screenshot({ type: "png" })).toString("base64");
        await context.close(); report.coverage.browser = true;
      });
      report.imageId = await call(["image", "inspect", "--format", "{{.Id}}", image], { signal });
      expect(/^sha256:[a-f0-9]{64}$/.test(report.imageId), "无法确认验证镜像的不可变 ID");
      report.passed = true;
    } catch (error) {
      report.passed = false;
      report.logs = String(error.message).slice(-24000);
    } finally {
      await browser?.close().catch(() => {});
      try { await removeContainer(name); }
      catch (error) { report.passed = false; report.logs += `\n容器未确认清理：${error.message}`; }
      if (createdVolume) await call(["volume", "rm", volume]).catch((error) => { report.passed = false; report.logs += `\n临时数据卷清理失败：${error.message}`; });
      if (createdNetwork) await call(["network", "rm", net]).catch((error) => { report.passed = false; report.logs += `\n临时网络清理失败：${error.message}`; });
      if (!report.passed) await call(["image", "rm", image]).catch(() => {});
    }
    signal?.throwIfAborted();
    return report;
  }
  async function prepareImage(files, image, validation, signal) {
    if (!/^sha256:[a-f0-9]{64}$/.test(validation?.imageId || ""))
      throw new Error("缺少已实测镜像的不可变 ID，拒绝重新构建后冒充相同版本");
    const hash = await call(["image", "inspect", "--format", '{{index .Config.Labels "ark.source"}}', validation.imageId], { signal });
    expect(hash === sourceHash(files), "已验证镜像与当前源码不一致");
    await call(["tag", validation.imageId, identifier(image)], { signal });
  }
  return { capability, validate, buildImage, prepareImage, createVolume, startContainer, health, network, removeContainer, command: call };
}
