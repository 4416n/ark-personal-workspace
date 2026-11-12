import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { materialize } from "./project-bundle.mjs";
import {
  sandboxAvailable,
  childEnv,
  bubbleArgs,
  toolchainMounts,
} from "./project-sandbox.mjs";

export const PREVIEW_MAX_FRAME_BYTES = 2 * 1024 * 1024;
export const PREVIEW_MAX_LIFETIME_MS = 10 * 60 * 1000;
export function validatePreviewFrame(value) {
  if (
    !value ||
    !["1280x800", "390x844"].includes(`${value.width}x${value.height}`) ||
    typeof value.png !== "string" ||
    value.png.length > Math.ceil(PREVIEW_MAX_FRAME_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.png)
  )
    throw new Error("预览图像格式无效");
  const bytes = Buffer.from(value.png, "base64");
  if (
    bytes.length < 33 ||
    bytes.length > PREVIEW_MAX_FRAME_BYTES ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString() !== "IHDR" ||
    bytes.readUInt32BE(16) !== value.width ||
    bytes.readUInt32BE(20) !== value.height
  )
    throw new Error("预览图像不是受支持的 PNG");
  return { png: value.png, width: value.width, height: value.height };
}
const unitCommand = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/systemctl", ["--user", ...args], {
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    child.stdout.on("data", (chunk) => {
      out = (out + chunk.toString()).slice(-4000);
    });
    child.stderr.on("data", (chunk) => {
      err = (err + chunk.toString()).slice(-4000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 6000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });

export async function launchPreview(files, { signal, onCleanup } = {}) {
  signal?.throwIfAborted();
  const available = await sandboxAvailable();
  if (!available.available)
    throw Object.assign(new Error(available.reason), { status: 503 });
  signal?.throwIfAborted();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ark-preview-"));
  const unit = "ark-preview-" + randomUUID() + ".service";
  let child, cleanupPromise, pending, readyResolve, readyReject;
  let closed = false,
    sequence = 0,
    buffer = "",
    logs = "",
    frameCount = 0;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // An abort may reject readiness while materialization is still awaiting filesystem IO.
  ready.catch(() => {});
  let startupTimer;
  const fail = (error) => {
    readyReject(error);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = null;
    }
  };
  const close = () => {
    if (cleanupPromise) return cleanupPromise;
    closed = true;
    clearTimeout(startupTimer);
    signal?.removeEventListener("abort", abort);
    fail(new Error("预览已停止"));
    cleanupPromise = (async () => {
      if (child) {
        child.stdin.destroy();
        await unitCommand([
          "kill",
          "--kill-whom=all",
          "--signal=KILL",
          unit,
        ]).catch(() => {});
        await unitCommand(["stop", unit]).catch(() => {});
        // First stop the launcher too: a not-found unit while its launcher is
        // still submitting the service must not be mistaken for completed cleanup.
        child.kill("SIGKILL");
        if (child.exitCode === null && child.signalCode === null)
          await new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("预览启动进程尚未退出")),
              2000,
            );
            child.once("close", () => {
              clearTimeout(timer);
              resolve();
            });
          });
        await unitCommand(["stop", unit]).catch(() => {});
        const state = await unitCommand([
          "show",
          "--property=ActiveState",
          "--property=LoadState",
          unit,
        ]);
        if (
          !(
            state.code === 0 &&
            /(?:^|\n)ActiveState=(?:inactive|failed)(?:\n|$)/.test(state.out)
          ) &&
          !/(?:^|\n)LoadState=not-found(?:\n|$)/.test(state.out)
        )
          throw new Error(
            "无法确认隔离预览已停止，工程执行保持锁定；请检查 systemd 用户服务",
          );
      }
      await fs.rm(directory, { recursive: true, force: true });
    })().catch((error) => {
      cleanupPromise = null;
      throw error;
    });
    return cleanupPromise;
  };
  const abort = () => void close().catch(() => {});
  onCleanup?.(close);
  try {
    await materialize(directory, files);
    await fs.mkdir(path.join(directory, "dist"));
    await fs.symlink(
      "/toolchain/node_modules",
      path.join(directory, "node_modules"),
    );
    const { chromium } = await import("@playwright/test");
    const browserRoot = path.dirname(
      path.dirname(path.dirname(chromium.executablePath())),
    );
    const mounts = await toolchainMounts();
    signal?.throwIfAborted();
    child = spawn(
      "/usr/bin/systemd-run",
      [
        "--user",
        "--quiet",
        "--wait",
        "--pipe",
        "--collect",
        "--unit=" + unit,
        "--property=MemoryMax=1024M",
        "--property=MemorySwapMax=0",
        "--property=TasksMax=192",
        "--property=CPUQuota=100%",
        "--property=RuntimeMaxSec=600",
        "--property=LimitCORE=0",
        "--property=LimitFSIZE=67108864",
        "/usr/bin/bwrap",
        ...bubbleArgs(directory, browserRoot, mounts, "preview-entry.mjs"),
      ],
      { env: childEnv, stdio: ["pipe", "pipe", "pipe"] },
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdin.on("error", (error) => {
      fail(error);
      void close().catch(() => {});
    });
    child.stderr.on("data", (chunk) => {
      logs = (logs + chunk.toString()).slice(-4000);
    });
    child.once("error", (error) => {
      fail(error);
      void close().catch(() => {});
    });
    child.once("close", () => {
      fail(new Error("隔离预览已退出：" + logs));
      void close().catch(() => {});
    });
    child.stdout.on("data", (chunk) => {
      if (closed) return;
      buffer += chunk.toString();
      if (buffer.length > 3 * 1024 * 1024) {
        fail(new Error("预览响应超过限制"));
        void close().catch(() => {});
        return;
      }
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const response = JSON.parse(line);
          if (response.error)
            throw new Error(String(response.error).slice(0, 2000));
          const frame = validatePreviewFrame(response);
          frameCount++;
          if (response.ready === true && frameCount === 1) {
            clearTimeout(startupTimer);
            readyResolve(frame);
          } else if (pending && response.id === pending.id) {
            const request = pending;
            pending = null;
            clearTimeout(request.timer);
            request.resolve(frame);
          } else throw new Error("意外的预览响应");
        } catch (error) {
          fail(error);
          void close().catch(() => {});
          return;
        }
      }
    });
    startupTimer = setTimeout(() => {
      fail(new Error("隔离预览启动超时"));
      void close().catch(() => {});
    }, 60000);
    const initialFrame = await ready;
    return {
      frame: initialFrame,
      alive: () => !closed,
      request(action) {
        if (closed) return Promise.reject(new Error("预览已停止"));
        if (pending)
          return Promise.reject(
            Object.assign(new Error("上一步预览操作尚未完成"), { status: 409 }),
          );
        return new Promise((resolve, reject) => {
          const id = ++sequence;
          pending = {
            id,
            resolve,
            reject,
            timer: setTimeout(() => {
              fail(new Error("预览操作超时，已停止隔离会话"));
              void close().catch(() => {});
            }, 20000),
          };
          child.stdin.write(JSON.stringify({ id, action }) + "\n");
        });
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
