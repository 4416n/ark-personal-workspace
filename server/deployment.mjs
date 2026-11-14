import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const parameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 256)
    throw new Error("工作台密码需要 12–256 个字符");
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64, parameters);
  return `scrypt:${salt}:${key.toString("hex")}`;
}

export function validPasswordHash(value) {
  return /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(value || "");
}

export async function verifyPassword(password, hash) {
  if (typeof password !== "string" || password.length > 256 || !validPasswordHash(hash))
    return false;
  const [, salt, expected] = hash.split(":");
  const key = await scrypt(password, salt, 64, parameters);
  return timingSafeEqual(key, Buffer.from(expected, "hex"));
}

export function deploymentConfig({ publicOrigin, passwordHash } = {}) {
  if (!publicOrigin && !passwordHash) return null;
  if (!publicOrigin || !validPasswordHash(passwordHash))
    throw new Error("远程部署必须同时配置 ARK_PUBLIC_ORIGIN 和有效的 ARK_PASSWORD_HASH");
  let url;
  try {
    url = new URL(publicOrigin);
  } catch {
    throw new Error("ARK_PUBLIC_ORIGIN 必须是完整访问地址，例如 https://ark.example.com");
  }
  const development = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(development && url.protocol === "http:")) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  )
    throw new Error("远程访问地址必须使用 HTTPS，且不能包含路径、凭据、查询或片段");
  return { origin: url.origin, host: url.host, passwordHash, secure: url.protocol === "https:" };
}

export function securityHeaders(remote) {
  return (_req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    if (remote?.secure) res.set("Strict-Transport-Security", "max-age=31536000");
    next();
  };
}
