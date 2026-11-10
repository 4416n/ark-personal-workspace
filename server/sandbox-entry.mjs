// Runs inside the network/filesystem/PID namespace. Nothing here writes to the host.
import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["/work/scripts/verify.mjs"], {
  cwd: "/work",
  env: process.env,
  stdio: ["ignore", "pipe", "pipe", "pipe"],
});
let report = "",
  overflow = false;
child.stdio[3].on("data", (b) => {
  if (overflow) return;
  report += b;
  if (report.length > 2000000) {
    overflow = true;
    child.kill("SIGKILL");
    report = "";
    process.exitCode = 1;
  }
});
// Application logs never go to the report channel.
child.stdout.on("data", (b) => process.stderr.write(b));
child.stderr.on("data", (b) => process.stderr.write(b));
child.on("close", (code) => {
  if (report) process.stdout.write("ARK_VERIFICATION_REPORT=" + report + "\n");
  process.exitCode = code === 0 && !overflow ? 0 : 1;
});
