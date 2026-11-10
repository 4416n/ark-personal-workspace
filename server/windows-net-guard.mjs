import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";

const blocked = () => {
  throw Object.assign(
    new Error("Windows 沙箱禁止生成代码访问网络"),
    { code: "ENETUNREACH" },
  );
};
net.Socket.prototype.connect = blocked;
tls.connect = blocked;
http.request = blocked;
http.get = blocked;
https.request = blocked;
https.get = blocked;
globalThis.fetch = async () => blocked();
