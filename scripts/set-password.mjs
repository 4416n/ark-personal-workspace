import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { hashPassword } from "../server/deployment.mjs";
import { projectRoot } from "./workspace-setup.mjs";

async function hiddenQuestion(prompt) {
  if (!process.stdin.isTTY) throw new Error("请在交互终端设置密码，或通过 --stdin 读取一行密码");
  process.stdout.write(prompt);
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const reader = createInterface({ input: process.stdin, output, terminal: true });
  try { return await reader.question(""); }
  finally { reader.close(); process.stdout.write("\n"); }
}

try {
  const args = process.argv.slice(2);
  const fromStdin = args.includes("--stdin");
  const position = args.indexOf("--output");
  if (args.some((arg, index) => !["--stdin", "--output"].includes(arg) && !(position >= 0 && index === position + 1)) || (position >= 0 && !args[position + 1]))
    throw new Error("用法：npm run password -- [--stdin] [--output deploy/password.hash]");
  const target = path.resolve(position >= 0 ? args[position + 1] : path.join(projectRoot, "deploy/password.hash"));
  let password;
  if (fromStdin) {
    let input = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 1024) throw new Error("密码输入过长");
    }
    password = input.replace(/\r?\n$/, "");
  } else {
    password = await hiddenQuestion("设置工作台密码（至少 12 个字符，输入不回显）：");
    if (password !== await hiddenQuestion("再次输入密码：")) throw new Error("两次密码不一致，文件未修改");
  }
  const hash = await hashPassword(password);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, `${hash}\n`, { mode: 0o600 });
  await fs.chmod(target, 0o600);
  console.log(`密码哈希已保存：${target}\n请妥善保存原密码；更换密码文件后需重启工作台，所有旧会话随重启失效。`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
