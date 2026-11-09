#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo '请先安装 Node.js 22.18 或更新版本，然后再次启动。'
  read -r -p '按回车退出...' || true
  exit 1
fi
if [ ! -d node_modules ]; then npm install; fi
if [ ! -f dist/index.html ] || find src server shared -type f -newer dist/index.html -print -quit | grep -q .; then
  npm run build
fi
if curl --silent --max-time 2 http://127.0.0.1:5173/api/health | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;try{process.exit(JSON.parse(s).ok?0:1)}catch{process.exit(1)}' 2>/dev/null; then
  echo '方舟工作台已经运行，正在打开浏览器。手机连接请进入「工作台设置 → 手机连接」。'
  if command -v xdg-open >/dev/null 2>&1; then xdg-open http://127.0.0.1:5173 >/dev/null 2>&1 || true; fi
  exit 0
fi
echo '正在启动方舟工作台（局域网共享）。手机连接请进入「工作台设置 → 手机连接」。保持本终端开启，按 Ctrl+C 可停止。'
if command -v xdg-open >/dev/null 2>&1; then
  (sleep 2; xdg-open http://127.0.0.1:5173 >/dev/null 2>&1 || true) &
fi
exec npm start
