@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.18 或更新版本，建议 Node.js 24 LTS，然后重新启动。
  pause
  exit /b 1
)
node scripts\launch.mjs %*
if errorlevel 1 pause
