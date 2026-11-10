import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
await fs.mkdir("dist/assets", { recursive: true });
await build({
  entryPoints: ["src/main.jsx"],
  bundle: true,
  outfile: "dist/assets/app.js",
  jsx: "automatic",
  platform: "browser",
  format: "esm",
  minify: true,
  loader: { ".svg": "dataurl", ".png": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
});
await fs.copyFile("index.html", "dist/index.html");
if (await fs.stat("public").catch(() => null))
  await fs.cp("public", "dist", { recursive: true });
if (!(await fs.stat(path.join(root, "dist/assets/app.css")).catch(() => null)))
  await fs.writeFile("dist/assets/app.css", "");
console.log("Frontend production bundle built.");
