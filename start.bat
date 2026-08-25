@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo   Digital Human Video Generator
echo ================================================
echo.

where.exe node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found.
    echo Please install Node.js 20 or newer, then run this file again.
    pause
    exit /b 1
)

if not exist ".env" (
    if exist ".env.example" (
        copy /Y ".env.example" ".env" >nul
        echo Created .env from .env.example.
    )
)

if not exist "node_modules\" (
    echo Installing dependencies. Please wait...
    call npm.cmd install --no-audit --no-fund
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

echo Starting video generator at http://127.0.0.1:8834
echo Close this window to stop the server.
echo.
call npm.cmd run dev

echo.
echo The video generator stopped.
pause
endlocal
