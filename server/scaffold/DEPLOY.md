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
