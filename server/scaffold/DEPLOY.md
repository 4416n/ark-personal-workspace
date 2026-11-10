# 运行与部署

这是完整源代码，不是公网托管服务。请先阅读 README.md 中的功能范围与已知限制，以及 verification-report.json 中的实际验证报告。

## 本机运行（Node.js 24+）

```sh
npm ci --ignore-scripts
npm run build
npm start
```

浏览器打开 http://127.0.0.1:8080。前端由同一个服务托管，前后端同源，API 位于 `/api`。
SQLite 数据保存在 `data/`（或 DATA_DIR 指定目录）。停止服务后再备份整个数据目录。

## 复现验证

```sh
npm test
npx playwright install chromium
npm run test:browser
```

测试启动临时服务、使用临时数据库，不改生产数据。测试会运行生成的程序，请优先在容器或专用环境中执行，不要赋予真实密钥。`npm test` 检查构建、启动、接口与重启持久化，完整浏览器检查使用第二条测试命令。

## Docker Compose

```sh
docker compose up --build -d
docker compose logs -f app
```

默认仅映射本机 127.0.0.1:8080，不自动对公网开放。数据使用命名卷 app-data；不要随意执行 `docker compose down -v`（会删除数据）。
Docker 构建需要网络拉取 Node 镜像和 npm 依赖；工作台的隔离测试不等于镜像构建或公网部署验证。

上线前请根据实际服务器配置域名、HTTPS 反向代理、身份认证、访问控制、限流和备份。不要直接公开包含私人数据、未完善权限的应用。模型生成的鉴权、财务与业务规则必须人工复核。工作台不会登录你的服务器、购买域名或自动发布。

## 动态验收契约（v2）

`tests/acceptance.json` 中除声明的 `api`、`browser` 外，还需 `persistence`：

```json
{
  "storage": { "table": "notes", "column": "title" },
  "create": { "method": "POST", "path": "/api/notes", "body": { "title": "{{value}}" }, "status": 201 },
  "read": { "method": "GET", "path": "/api/notes", "status": 200 },
  "idPointer": "/id",
  "update": { "method": "PATCH", "path": "/api/notes/{{id}}", "body": { "title": "{{value}}" }, "status": 200 },
  "remove": { "method": "DELETE", "path": "/api/notes/{{id}}", "status": 200 }
}
```

`{{value}}` 由验证器运行时生成，写入声明的业务表字段；更新使用另一个随机值。ID 从创建响应的 `idPointer` 读取，支持整数或字母/数字/下划线/短横线字符串。更新、硬删除仅在业务支持时声明，否则省略并标为未覆盖；软删除需另行验收。不会只检查响应码或数据库文件头：操作后会停止应用、只读检查业务字段、重启再读取接口。

浏览器 `fill` 和 `text` 的值须包含 `{{browserValue}}`。它是独立随机值，要求写入同一业务字段；随后重启服务，在没有浏览器本地缓存的新上下文读回。当前契约只覆盖一个文本字段的生命周期，不等同完整业务、安全或部署验收。旧版固定样例契约不会自动获得新标准通过结果。
