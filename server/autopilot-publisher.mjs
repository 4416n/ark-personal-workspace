import { createHash } from "node:crypto";

export function caddyPublisher({ domain = process.env.ARK_RELEASE_DOMAIN, adminUrl = process.env.ARK_CADDY_ADMIN || "http://127.0.0.1:2019", server = process.env.ARK_CADDY_SERVER || "srv0", fetcher = fetch } = {}) {
  if (!domain) return null;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || !/^[A-Za-z0-9_-]{1,80}$/.test(server))
    throw new Error("自动发布域名或 Caddy 服务名称无效");
  const admin = new URL(adminUrl);
  if (admin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(admin.hostname) || admin.username || admin.password || admin.pathname !== "/" || admin.search || admin.hash)
    throw new Error("Caddy 管理接口必须是本机 HTTP 地址");
  const request = (pathname, method = "GET", body) => fetcher(new URL(pathname, admin), { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000), redirect: "error" });
  return {
    async publish(projectId, port) {
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("发布端口无效");
      const key = createHash("sha256").update(projectId).digest("hex").slice(0, 16);
      const host = `app-${key}.${domain}`;
      const id = `ark-auto-${key}`;
      const route = { "@id": id, match: [{ host: [host] }], handle: [{ handler: "reverse_proxy", upstreams: [{ dial: `127.0.0.1:${port}` }] }], terminal: true };
      const existing = await request(`/id/${id}`);
      if (!existing.ok && existing.status !== 404) throw new Error("无法读取 Caddy 自动发布路由");
      const response = existing.ok
        ? await request(`/id/${id}`, "PATCH", route)
        : await request(`/config/apps/http/servers/${server}/routes/0`, "PUT", route);
      if (!response.ok) throw new Error(`Caddy 路由发布失败：HTTP ${response.status}`);
      return `https://${host}`;
    },
  };
}
