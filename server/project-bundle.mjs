import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const scaffold = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "scaffold",
);
const fixed = [
  "package.json",
  "package-lock.json",
  "scripts/build.mjs",
  "scripts/verify.mjs",
  "server/start.mjs",
  "index.html",
  "Dockerfile",
  "compose.yaml",
  ".dockerignore",
  ".gitignore",
  "DEPLOY.md",
];
const pathSchema = z
  .string()
  .max(180)
  .refine((p) => {
    if (
      !/^(?:src\/[A-Za-z0-9_/-]+\.(?:jsx|js|css|json|svg)|server\/(?:app\.mjs|modules\/[A-Za-z0-9_/-]+\.mjs)|public\/[A-Za-z0-9_/-]+\.(?:svg|json|txt)|README\.md)$/.test(
        p,
      )
    )
      return false;
    return !p
      .split("/")
      .some(
        (x) =>
          !x ||
          x === "." ||
          x === ".." ||
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(x),
      );
  }, "非法或保留的工程文件路径");
const apiCase = z.object({
  name: z.string().trim().min(1).max(160),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z
    .string()
    .regex(/^\/api\/[A-Za-z0-9_/?=&%.+-]{1,180}$/)
    .refine((v) => {
      try {
        return (
          !decodeURIComponent(v).includes("..") &&
          new URL(v, "http://sandbox.local").pathname.startsWith("/api/")
        );
      } catch {
        return false;
      }
    }),
  body: z.unknown().optional(),
  status: z.number().int().min(200).max(499),
  contains: z.string().min(1).max(1000),
});
const browserCase = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("click"),
    selector: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal("fill"),
    selector: z.string().min(1).max(200),
    value: z.string().max(2000),
  }),
  z.object({ action: z.literal("text"), value: z.string().min(1).max(1000) }),
]);
export const sourceFiles = (files) =>
  files.filter((f) => pathSchema.safeParse(f.path).success);
export const bundleSchema = z.object({
  summary: z.string().trim().min(1).max(3000),
  files: z
    .array(z.object({ path: pathSchema, content: z.string().max(160000) }))
    .min(4)
    .max(60),
  tests: z.object({
    api: z.array(apiCase).min(2).max(12),
    browser: z.array(browserCase).min(2).max(12),
  }),
});
export function parseBundle(content) {
  if (Buffer.byteLength(content) > 650000)
    throw new Error("工程输出总量超过上限");
  let bundle;
  try {
    bundle = bundleSchema.parse(
      JSON.parse(
        content
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, ""),
      ),
    );
  } catch (e) {
    throw new Error(
      "工程输出格式无效：" +
        (e.issues?.[0]?.message ||
          "必须返回完整 JSON 文件列表，不能只返回 Markdown 或截断代码"),
    );
  }
  if (Buffer.byteLength(JSON.stringify(bundle.tests)) > 32000)
    throw new Error("验收用例超过32KB");
  const names = new Set();
  let bytes = 0;
  for (const f of bundle.files) {
    const lower = f.path.toLowerCase();
    if (names.has(lower)) throw new Error("工程文件路径重复：" + f.path);
    names.add(lower);
    bytes += Buffer.byteLength(f.content);
    if (f.content.includes("\0")) throw new Error("工程文件包含空字符");
  }
  for (const required of [
    "src/main.jsx",
    "src/styles.css",
    "server/app.mjs",
    "README.md",
  ])
    if (!bundle.files.some((f) => f.path === required && f.content.trim()))
      throw new Error("缺少完整工程必要文件：" + required);
  if (bytes > 600000) throw new Error("工程文件总量超过 600KB，请缩小首版范围");
  if (
    !bundle.tests.browser.some(
      (t) => t.action === "click" || t.action === "fill",
    ) ||
    !bundle.tests.browser.some((t) => t.action === "text")
  )
    throw new Error("浏览器验收必须包含实际交互和文本断言");
  if (
    !bundle.tests.api.some((t) => t.method === "GET") ||
    !bundle.tests.api.some((t) => t.method !== "GET")
  )
    throw new Error("接口验收必须包含读取和写入行为");
  return bundle;
}
export async function assembleBundle(bundle) {
  const files = [...bundle.files];
  for (const name of fixed)
    files.push({
      path: name,
      content: await fs.readFile(path.join(scaffold, name), "utf8"),
    });
  files.push({
    path: "tests/acceptance.json",
    content: JSON.stringify(bundle.tests, null, 2) + "\n",
  });
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export const sourceHash = (files) =>
  createHash("sha256").update(JSON.stringify(files)).digest("hex");
export async function materialize(directory, files) {
  for (const f of files) {
    const file = path.join(directory, f.path);
    if (!file.startsWith(directory + path.sep)) throw new Error("文件路径越界");
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.writeFile(file, f.content, { flag: "wx", mode: 0o600 });
  }
}
// Stored ZIP (no compression); file names have already been validated, no symlinks.
export function zipFiles(files) {
  const crc = (buffer) => {
    let n = 0xffffffff;
    for (const b of buffer) {
      n ^= b;
      for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
    }
    return (n ^ 0xffffffff) >>> 0;
  };
  const locals = [],
    central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.path),
      data = Buffer.from(f.content),
      sum = crc(data);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(0x800, 6);
    l.writeUInt16LE(0x21, 12);
    l.writeUInt32LE(sum, 14);
    l.writeUInt32LE(data.length, 18);
    l.writeUInt32LE(data.length, 22);
    l.writeUInt16LE(name.length, 26);
    locals.push(l, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(sum, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += l.length + name.length + data.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
