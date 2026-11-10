import { deliveryMarkdown } from "./contract.mjs";

export function resultPreview(text, limit = 96) {
  const plain = String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`[\]()!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain;
}

export function safeFileName(name) {
  return String(name || "未命名")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "未命名";
}

export function deliverableFiles(project, tasks, members = []) {
  const names = new Map(members.map((member) => [member.id, member.name]));
  const files = tasks
    .filter((task) => task.result?.trim())
    .map((task, index) => ({
      name: `${String(index + 1).padStart(2, "0")}-${safeFileName(task.title)}.md`,
      content: `# ${task.title}\n\n负责人：${names.get(task.ownerId) || "未分配"}\n\n${task.result}`,
    }));
  return [
    { name: "00-总文档.md", content: deliveryMarkdown(project, tasks) },
    ...files,
  ];
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (~crc) >>> 0;
}

function concat(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

// Uncompressed ZIP so the browser can download deliverables without a library.
export function zipStore(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    centrals.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
    locals.push(local);
  }
  const central = concat(centrals);
  return concat([
    ...locals,
    central,
    concat([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(central.length),
      u32(offset),
      u16(0),
    ]),
  ]);
}
