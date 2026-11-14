import fs from "node:fs";
import path from "node:path";

export function privateStore(directory, filename, initial) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, filename);
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw new Error(`无法读取 ${filename}，请先恢复有效备份：${error.message}`);
    value = structuredClone(initial);
  }
  return {
    read: () => structuredClone(value),
    write(next) {
      const temporary = file + ".tmp";
      const descriptor = fs.openSync(temporary, "w", 0o600);
      try { fs.writeFileSync(descriptor, JSON.stringify(next)); fs.fsyncSync(descriptor); }
      finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, file);
      value = structuredClone(next);
    },
  };
}
