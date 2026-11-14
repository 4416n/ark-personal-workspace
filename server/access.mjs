import os from "node:os";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { verifyPassword } from "./deployment.mjs";

export const loopback = (ip) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
export function lanAddresses() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, values]) =>
    /docker|veth|br-|tun|clash/i.test(name)
      ? []
      : (values || [])
          .filter(
            (x) =>
              !x.internal &&
              x.family === "IPv4" &&
              /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address),
          )
          .map((x) => ({ name, address: x.address })),
  );
}
export function accessControl({ lan, shared, initialized, remote = null }) {
  let pairing = null;
  const sessions = new Map();
  const attempts = new Map();
  function local(req) {
    if (remote) return !!session(req);
    return (
      loopback(req.socket.remoteAddress) &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(req.hostname)
    );
  }
  const token = (req) =>
    /(?:^|;\s*)ark_session=([a-f0-9]+)/.exec(req.headers.cookie || "")?.[1];
  function prune() {
    const now = Date.now();
    for (const [key, value] of sessions)
      if (value.expires <= now) sessions.delete(key);
    for (const [key, value] of attempts)
      if (value.reset <= now) attempts.delete(key);
  }
  function session(req) {
    const value = sessions.get(token(req));
    return value && value.expires > Date.now() ? value : null;
  }
  function issueSession(res) {
    prune();
    if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
    const value = randomBytes(32).toString("hex");
    sessions.set(value, { expires: Date.now() + 7 * 86400000 });
    res.setHeader(
      "Set-Cookie",
      `ark_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${remote?.secure ? "; Secure" : ""}`,
    );
  }
  function allowAttempt(key, limit) {
    prune();
    const record = attempts.get(key) || { count: 0, reset: Date.now() + 60000 };
    if (!attempts.has(key) && attempts.size >= 1000) return false;
    attempts.set(key, record);
    return ++record.count <= limit;
  }
  let loginBusy = false;
  function authenticated(req) {
    return local(req) || !!session(req);
  }
  const guard = (req, res, next) => {
    const hosts = [
      "localhost",
      "127.0.0.1",
      "::1",
      "[::1]",
      ...(lan ? lanAddresses().map((x) => x.address) : []),
    ];
    if (remote ? req.get("host") !== remote.host : !hosts.includes(req.hostname))
      return res.status(403).json({ error: "访问地址不属于本工作台" });
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    if (req.get("Sec-Fetch-Site") === "cross-site")
      return res.status(403).json({ error: "不允许跨站请求。" });
    if (req.headers.origin) {
      try {
        if (remote
          ? req.headers.origin !== remote.origin
          : new URL(req.headers.origin).host !== req.get("host"))
          return res.status(403).json({ error: "不允许跨站请求。" });
      } catch {
        return res.status(403).json({ error: "请求来源无效。" });
      }
    }
    if (remote && !["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin !== remote.origin)
      return res.status(403).json({ error: "远程写入必须来自工作台页面。" });
    if (["/health", "/session", remote ? "/auth/login" : "/pair"].includes(req.path)) return next();
    if (!authenticated(req))
      return res.status(401).json({ error: remote ? "请先登录工作台" : "请先输入电脑上的连接码" });
    next();
  };
  const localOnly = (req, res, next) =>
    local(req)
      ? next()
      : res.status(403).json({ error: "请在电脑的本机地址管理连接和模型密钥" });
  function install(app) {
    app.get("/api/session", (req, res) =>
      res.json({
        shared,
        local: local(req),
        authenticated: authenticated(req),
        initialized: initialized(),
        lan,
        remote: !!remote,
      }),
    );
    app.post("/api/auth/login", async (req, res, next) => {
      if (!remote) return res.status(404).json({ error: "当前未启用远程登录" });
      if (loginBusy || !allowAttempt("login", 8))
        return res.status(429).json({ error: "尝试次数过多，请一分钟后重试" });
      loginBusy = true;
      try {
        if (!await verifyPassword(req.body?.password, remote.passwordHash))
          return res.status(401).json({ error: "工作台密码不正确" });
        issueSession(res);
        res.json({ ok: true });
      } catch (error) {
        next(error);
      } finally {
        loginBusy = false;
      }
    });
    app.post("/api/auth/logout", (req, res) => {
      sessions.delete(token(req));
      res.setHeader("Set-Cookie", `ark_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${remote?.secure ? "; Secure" : ""}`);
      res.json({ ok: true });
    });
    app.post("/api/pair", (req, res) => {
      if (remote) return res.status(404).json({ error: "远程工作台请使用密码登录" });
      const ip = req.socket.remoteAddress;
      const now = Date.now();
      if (!allowAttempt(ip, 8))
        return res.status(429).json({ error: "尝试次数过多，请一分钟后重试" });
      const code = String(req.body.code || "");
      if (
        !lan ||
        !pairing ||
        pairing.expires < now ||
        !/^\d{8}$/.test(code) ||
        !timingSafeEqual(Buffer.from(code), Buffer.from(pairing.code))
      )
        return res
          .status(401)
          .json({ error: "连接码无效或已过期，请在电脑上重新生成" });
      issueSession(res);
      pairing = null;
      res.json({ ok: true });
    });
    app.get("/api/connection", localOnly, (req, res) =>
      res.json({
        lan,
        addresses: lanAddresses().map((x) => ({
          ...x,
          url: `http://${x.address}:${req.socket.localPort}`,
        })),
        devices: [...sessions.values()].filter((s) => s.expires > Date.now())
          .length,
      }),
    );
    app.post("/api/connection/code", localOnly, (_req, res) => {
      if (!lan) return res.status(400).json({ error: "请使用局域网启动方式" });
      pairing = {
        code: String(randomInt(10000000, 100000000)),
        expires: Date.now() + 300000,
      };
      res.json(pairing);
    });
    app.delete("/api/connection/devices", localOnly, (_req, res) => {
      sessions.clear();
      pairing = null;
      res.json({ ok: true });
    });
  }
  return {
    guard,
    install,
    localOnly,
    local,
    revoke: () => {
      sessions.clear();
      pairing = null;
    },
  };
}
