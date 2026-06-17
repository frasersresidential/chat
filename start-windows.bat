@echo off
REM ============================================================
REM  OmniChat - One-click launcher for Windows (ASCII only)
REM  Double-click to run. First run installs dependencies.
REM  This window stays open on error so you can read messages.
REM ============================================================
title OmniChat Server
cd /d "%~dp0"

echo ============================================
echo    OmniChat - Omni-Channel Inbox
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :nonode
echo [1/3] Node.js found:
call node -v
echo.

if not exist "package.json" goto :nopkg
if not exist "node_modules" goto :install
echo [2/3] Dependencies already installed.
goto :run

:install
echo [2/3] Installing dependencies for the first time. Please wait 1-2 minutes...
call npm install
if errorlevel 1 goto :installfail
echo.
goto :run

:run
echo [3/3] Starting server...
echo Open http://localhost:3000 in your browser.
echo Keep THIS window open. Press Ctrl+C to stop the app.
echo.
start "" cmd /c "timeout /t 4 >nul && start http://localhost:3000"
call npm start
echo.
echo [X] Server stopped. See messages above.
goto :hold

:nonode
echo [X] Node.js is not installed on this PC.
echo     Install it from https://nodejs.org  ^(choose LTS^) then restart your PC.
goto :hold

:nopkg
echo [X] package.json not found in this folder.
echo     Make sure you extracted the ZIP and this file sits inside the project folder.
echo     Current folder: %CD%
goto :hold

:installfail
echo [X] npm install failed. Check your internet connection and try again.
echo     The error message is shown above.
goto :hold

:hold
echo.
echo ============================================
echo  Press any key to close this window...
echo ============================================
pause >nul
