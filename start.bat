@echo off
chcp 65001 >nul
title AbaChat 启动器

cls
echo.
echo ========================================
echo          AbaChat 私密聊天室
echo          (双击即可启动)
echo ========================================
echo.

:: 检查 Node.js 是否已安装
echo [1/4] 检查 Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ❌ 错误：未检测到 Node.js
    echo.
    echo 请先安装 Node.js：
    echo 下载地址：https://nodejs.org/zh-cn/download/
    echo.
    echo 安装完成后，请重新运行此脚本。
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo ✅ Node.js 已安装: %NODE_VERSION%
echo.

:: 检查 npm 是否已安装
echo [2/4] 检查 npm...
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误：npm 不可用
    pause
    exit /b 1
)
echo ✅ npm 已就绪
echo.

:: 安装依赖
echo [3/4] 正在检查并安装依赖...
echo      (首次运行可能需要几分钟，请耐心等待)
echo.
npm install --silent

if %errorlevel% neq 0 (
    echo.
    echo ❌ 依赖安装失败
    echo 请检查网络连接，然后重新运行此脚本。
    pause
    exit /b 1
)

echo ✅ 依赖安装完成
echo.

:: 启动服务器
echo [4/4] 正在启动 AbaChat 服务器...
echo.
echo ========================================
echo    服务器已启动！
echo.
echo    请打开浏览器访问：
echo         http://localhost:3000
echo.
echo    关闭此窗口将停止服务器
echo ========================================
echo.

npm start