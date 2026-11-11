import { deflateSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { seedWorkspace } from "../../src/domain.ts";
import { assembleBundle, sourceHash } from "../../server/project-bundle.mjs";
import { requirements, requirementsHash } from "../../server/requirements.mjs";
import { fullstackFixture } from "./fullstack.mjs";

function pngChunk(name, content) {
  const type = Buffer.from(name);
  const data = Buffer.concat([type, content]);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const head = Buffer.alloc(4),
    tail = Buffer.alloc(4);
  head.writeUInt32BE(content.length);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([head, data, tail]);
}
// A valid blank PNG for protocol/UI tests. This is explicitly a mock, not generated-app evidence.
export function previewFrame(width = 1280, height = 800) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return {
    width,
    height,
    png: Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", deflateSync(Buffer.alloc((width * 3 + 1) * height, 0))),
      pngChunk("IEND", Buffer.alloc(0)),
    ]).toString("base64"),
  };
}
export async function seedPreview(database) {
  const state = seedWorkspace();
  state.projects = [
    {
      ...state.projects[0],
      title: "安全预览测试工程",
      deliveryType: "software",
    },
  ];
  state.tasks = [];
  state.knowledge = [];
  database.save(state, 0);
  const files = await assembleBundle(fullstackFixture());
  const hash = sourceHash(files);
  const build = {
    id: randomUUID(),
    projectId: state.projects[0].id,
    title: state.projects[0].title,
    status: "verified",
    summary: "测试样例工程，mock验证元数据",
    startedAt: new Date().toISOString(),
    sourceHash: hash,
    requirementsHash: requirementsHash(
      requirements(state, state.projects[0].id),
    ),
    requirementsVersion: 2,
    files,
    attempts: [],
    validation: {
      passed: true,
      verificationVersion: 2,
      sourceHash: hash,
      checks: [],
      logs: "mock fixture only",
    },
  };
  database.saveBuild(build);
  return { state, build };
}
