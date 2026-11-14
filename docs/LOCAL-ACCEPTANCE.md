# 本地交付与验收记录

验收日期：2026-11-14。基础仓库：`https://github.com/4416n/ark-personal-workspace`，拉取时 HEAD：`80d152d`。本记录说明增强版的本机验收结果；代码提交与推送不代表真实容器或公网部署已经验收。

## 已完成

- 全自动交付入口：一次输入目标，自动拆解、分阶段生成、有限修复/恢复、Docker 实测、证据门禁、部署与健康检查，无逐阶段确认；关闭浏览器继续，服务重启从检查点续跑，主动停止后不偷跑。
- 不可变镜像发布与数据保护：生产使用实测镜像 ID；切换前停止旧版、复制一致数据卷，新版失败恢复旧版，三次健康失败回滚，暂时恢复失败自动重试，保留失败及历史数据线索。
- 可选 Caddy 独立 HTTPS 应用域名；生成容器使用内部网络、资源限制，不挂载宿主机目录、控制器密钥或 Docker socket。完整工作台备份不含部署元数据与 Docker 卷，须另外备份。
- 远程单人密码登录、退出、密码哈希设置工具、内存会话与重启失效、来源/域名校验、登录尝试限制。
- 工作台提醒中心：待验收、逾期、今日到期、待分配、AI 执行完成/失败，任务直达、浏览器已读状态及移动端弹窗。
- Docker 多阶段构建、非 root 运行、数据卷、只读应用目录、健康检查与资源限制，Caddy HTTPS / Compose 和 systemd 部署样例。
- CSP 和禁止嵌入等响应头、首页重新校验、静态资源缓存、React 分包；远程模式使用服务器存储提示。
- 保留已有项目、员工、知识、自动执行、审批、源码导出、完整备份、局域网配对及离线同步流程。

## 本机验证结果

环境：Windows，Node.js 22.23.5，npm 10.9.9，Playwright Chromium。

| 验证 | 结果 |
| --- | --- |
| `npm run build` | 通过 TypeScript 检查与生产构建；入口 JS 约 295 KB，React 独立分包约 213 KB（未压缩） |
| `npm test` | 162 项：159 通过、3 项平台条件跳过、0 失败；新增自动规划到发布、断点恢复、显式停止、并发防重、旧卷复制、发布失败恢复及自动回滚反例；Docker 适配器模拟覆盖生命周期和镜像 ID 校验失败 |
| `npm run test:e2e` | 58/58 通过，覆盖桌面、390px 手机、登录退出、同步冲突、离线编辑、备份恢复、一次启动无逐阶段弹窗及 Docker 证据显示；模型与发布适配器为模拟服务 |
| `npm run test:autopilot` | **未通过环境前置检查**：`spawn docker ENOENT`；没有执行实际容器构建、发布或回滚，不视作平台跳过通过 |
| `npm audit --registry=https://registry.npmjs.org` | 当前依赖锁未报告已知漏洞（包括开发依赖） |
| `git diff --check` | 通过 |
| 本机生产服务 | `127.0.0.1:5173` 健康接口返回 `{"ok":true}`，仅监听本机地址；仍是原有后端进程，尚未载入全自动 API |

构建有第三方 zod 注释标记警告，不影响构建。SQLite 在当前 Node 22 输出 experimental 提示；部署镜像使用 Node 24。

本次最终替换本机后台进程、以及另起新端口的启动命令被执行策略拒绝，未继续绕过。现有工作台和数据没有被停止或覆盖；新代码已构建，需由本机用户先停止原服务再执行 `npm run start:local`。仅刷新旧进程页面会看到新静态页面，但旧后端尚不提供 `/api/autopilot`，不能据此认定自动功能已运行。

页面截图位于本地 `artifacts/release-reminders-mobile.png`、`artifacts/release-remote-settings.png`、`artifacts/autopilot-phone.png` 和 `artifacts/autopilot-completed-phone.png`。成功交付截图来自明确标识的模拟环境，不证明本机真实部署；未纳入 Git。

## 尚需目标环境验证

本机没有 Docker Engine 或可用 Linux systemd 用户环境。固件虚拟化已开启，但 WSL / VirtualMachinePlatform 功能均为 Disabled，HypervisorPresent 为 False；未擅自开启系统功能或重启电脑。因此未执行容器镜像构建、Compose 启动、真实域名 TLS、Linux 工程隔离与交互预览。CI 已增加真实 Docker 自动发布/数据复制/健康回滚，以及容器登录和重启持久化检查；本记录没有远端运行通过证据，不能将新增配置或推送成功视作 CI 已通过。

没有使用真实付费模型，AI 测试使用模拟服务。上线前需要部署服务器、域名、独立工作台密码及自己的模型配置，按 [部署说明](DEPLOYMENT.md) 与 [全自动运行环境](AUTOPILOT.md) 完成服务器验收。当前状态是自动流水线代码及模拟回归通过的部署候选版，尚未在真实容器中完成端到端验收，也尚未公开上线。
