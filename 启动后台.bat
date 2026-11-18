@echo off
chcp 65001 >nul
title 婚礼请帖后台
cd /d "%~dp0"

rem ===== 后台口令：记得改成你自己的，并且记下来 =====
set ADMIN_TOKEN=wedding2026

if not exist data mkdir data

echo.
echo   正在启动婚礼请帖后台...
echo   浏览器会自动打开，如果没有，手动打开控制台里显示的地址。
echo   关闭这个黑窗口就停止服务。
echo.

start "" http://localhost:8080/
node server.js

echo.
echo   服务已退出。按任意键关闭。
pause >nul
