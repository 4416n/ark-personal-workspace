# 部署个人工作台

本版增加单人工作台的远程密码登录、HTTPS 反向代理和容器持久化配置。一个密码代表工作台所有者，登录后可管理模型密钥、备份及全部项目；不要将密码作为多人协作账号分享。默认本机与可信局域网启动方式继续可用。

新增的目标到部署全自动控制器使用独立的主机 Node + Docker 运行方式，见 [全自动开发与部署](AUTOPILOT.md)。本页的精简 Compose 镜像提供基础工作台，不包含 Docker 控制器。

## 本机使用

Windows 双击根目录的 `启动工作台.cmd`，或在项目目录执行：

```powershell
npm ci
npm run build
npm run start:local
```

打开 `http://127.0.0.1:5173`。数据保存在项目 `.local`，请定期在设置下载完整备份。模型需自行在设置中连接；未配置时可使用离线规划、任务和知识管理。

## 服务器部署：Docker Compose + HTTPS

需要一台装有 Docker Engine 与 Compose 插件的 Linux 服务器，一个已解析到服务器的域名，以及可用的 TCP 80/443 端口。HTTPS 由 Caddy 自动申请和续期证书。工作台服务不直接发布 5173 端口。

1. 克隆代码，复制 `.env.example` 为 `.env`，将 `ARK_DOMAIN` 改成自己的域名，只填域名，不带 `https://`、路径或端口。
2. 在装有 Node.js 22.18+ 的交互终端执行 `npm run password`。输入至少 12 个字符的独立密码，终端不回显；只保存 scrypt 哈希到 `deploy/password.hash`，不保存明文。此步骤不需要安装 npm 依赖，也可以在自己的电脑生成后将哈希文件安全复制到服务器。
3. Linux 的 Compose 文件型 secret 保留源文件的权限，容器以 UID 1000/GID 1000 运行。确保哈希文件对该用户可读，例如在服务器运行 `sudo chown 1000:1000 deploy/password.hash` 和 `sudo chmod 600 deploy/password.hash`。后续换密码后再次检查权限。
4. 在项目根目录执行：

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 workspace https
```

5. 打开 `https://你的域名`，输入刚设置的密码，进入设置填写个人资料和模型连接。手机可打开同一 HTTPS 地址登录，不需要局域网连接码。

容器使用 Node.js 24、非 root 用户、只读应用目录、独立数据卷、资源上限、日志滚动与健康检查。Caddy 压缩静态内容；带哈希的资源缓存一年，首页每次重新校验，API 禁止缓存。工作台设置了 CSP、禁止外站嵌入、来源校验及远程写入的 Origin 校验。

### 登录与恢复

- 登录失败最多每分钟 8 次，登录计算串行处理；限制是整个工作台共用，不能靠伪造 `X-Forwarded-For` 绕过。
- 会话最长七天，只保存在服务内存中；重启会注销全部设备。HTTPS Cookie 设置 `Secure`、`HttpOnly`、`SameSite=Strict`。
- 退出按钮会先等待当前修改保存；退出后不能再读取工作台接口。若保存冲突或连接失败，请先解决问题再退出。
- 忘记密码：重新运行 `npm run password`、确认文件权限，然后 `docker compose restart workspace`。所有旧会话失效；工作台数据和模型配置保留。
- 每个已登录浏览器仍会缓存业务数据与离线草稿。主动退出前保存修改，退出时清除当前工作台缓存和待同步内容；其他历史恢复副本仍可能存在，共享电脑建议使用独立浏览器配置或清除站点数据。

### 数据、升级与回滚

业务 SQLite、每日备份、完整备份和模型配置保存在 `workspace_data` 卷。普通 `docker compose down` 不删除数据；`down -v` 会删除卷，不应作为升级命令。

升级前在设置导出完整备份，并单独保存模型配置。完整备份不包含 API Key；恢复后必须重新验证工程，不会自动启动付费任务。更新代码后运行 `docker compose up -d --build`。升级异常时退回原源码版本重新构建，并根据需要从可信完整备份恢复。不要在服务写入时只复制 SQLite 主文件，遗漏 WAL 会损失最新数据。

`docker compose ps` 查看健康状态，`docker compose logs --tail=100 workspace` 排查启动和权限问题。不要将完整数据库、模型配置、密码哈希或备份提交到仓库。

## 已有反向代理或 systemd 部署

可不使用容器。安装 Node.js 24，执行 `npm ci && npm run build`，生成密码文件后配置：

```bash
export ARK_PUBLIC_ORIGIN=https://ark.example.com
export ARK_PASSWORD_HASH_FILE=/absolute/path/to/deploy/password.hash
export ARK_DATA_DIR=/absolute/path/to/private-data
export PORT=5173
node server/index.mjs --production
```

默认监听 `127.0.0.1`。反向代理必须保留原始 `Host`，只允许配置中的 HTTPS 域名访问，并负责 TLS 终止。应用不信任 `X-Forwarded-Host` 或 `X-Forwarded-For`。也可用 `ARK_PASSWORD_HASH` 传入哈希，但不能与 `ARK_PASSWORD_HASH_FILE` 同时设置。禁止将远程模式与 `--lan` 或 `ARK_LEGACY=1` 混用。非本机监听必须显式启用受保护的远程或局域网模式。

提供 [systemd 服务样例](../deploy/ark-workspace.service) 与 [环境文件样例](../deploy/server.env.example)。根据实际目录和 Node 路径修改后，由服务器管理员创建 `ark` 用户和 `/var/lib/ark-workspace`，授予该用户读写权限并安装、启用服务；环境文件、密码文件和数据目录只允许运行用户读取。此样例用于基础工作台，其权限收紧不提供工程隔离所需的用户服务；反向代理另行配置。

## 工程验证的运行边界

Docker Compose 镜像运行工作台、文档自动执行、知识管理、网站源码生成与导出。此精简镜像没有 systemd 用户会话、bubblewrap 和 Chromium，因此**不执行生成代码的隔离验证与交互预览**，工程会保留未验证源码并明确提示。不要为启用该能力添加 `privileged` 或挂载 Docker socket。

需要工程验证时，在满足 Node.js 24、bubblewrap、systemd 用户服务和 Chromium 的独立 Linux 环境部署，先在设置运行工程环境检查，再运行 `npm run test:sandbox` 与 `npm run test:preview`。本次本机为 Windows，没有 Docker/Linux，尚未验证容器构建、证书申请及真实 Linux 隔离运行；上线服务器须完成这些环境检查。

## 上线验证

1. `npm run check`：生产构建、逻辑/API、桌面和 390px 手机端回归。
2. `npm audit --registry=https://registry.npmjs.org`：检查当前锁文件的已知依赖漏洞。
3. 服务器执行 Compose 构建并确认两个服务运行正常；使用自己的域名检查 HTTPS 和登录。
4. 未登录访问 `/api/workspace` 应返回 401，退出后旧会话同样无效。
5. 修改资料、新建项目或笔记，刷新和重启后确认仍然存在；导出一份完整备份并在测试实例恢复。
6. 用自己的模型完成一个小任务并人工验收，确认服务商兼容性、输出质量和费用。自动测试使用模拟模型，不代替真实模型评估。
