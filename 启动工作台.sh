#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 22.18 或更新版本，然后再次启动。'
  read -r -p '按回车退出...' || true
  exit 1
fi
exec node scripts/launch.mjs "$@"
