import express from "express";
import fs from "node:fs";
import path from "node:path";
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  next();
});
app.get("/healthz", (_req, res) => res.json({ ok: true }));
fs.mkdirSync(process.env.DATA_DIR || "./data", { recursive: true });
const { default: api } = await import("./app.mjs");
app.use("/api", api);
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "API not found" }),
);
app.use(express.static(path.resolve("dist")));
app.get("/{*path}", (req, res) => {
  // Missing assets must not look like a successful HTML response.
  if (
    req.path.startsWith("/assets/") ||
    path.extname(req.path) ||
    !req.accepts("html")
  )
    return res.status(404).json({ error: "Resource not found" });
  res.sendFile(path.resolve("dist/index.html"));
});
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  res
    .status(status)
    .json({
      error:
        status === 500
          ? "Internal server error"
          : status === 413
            ? "Request too large"
            : "Invalid request",
    });
});
const server = app.listen(
  Number(process.env.PORT) || 8080,
  process.env.HOST || "127.0.0.1",
  () => console.log("Application started"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
