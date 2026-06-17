@echo off
REM ============================================================
REM  OmniChat - One-click launcher for Windows
REM  ดับเบิลคลิกไฟล์นี้เพื่อรันแอป (ครั้งแรกจะติดตั้ง dependency ให้อัตโนมัติ)
REM ============================================================
chcp 65001 >nul
title OmniChat Server
cd /d "%~dp0"

echo.
echo ============================================
echo    OmniChat - Omni-Channel Inbox
echo ============================================
echo.

REM --- ตรวจว่ามี Node.js หรือยัง ---
where node >nul 2>nul
if errorlevel 1 (
  echo [!] ไม่พบ Node.js บนเครื่องนี้
  echo     กรุณาติดตั้งก่อนที่: https://nodejs.org  ^(เลือกเวอร์ชัน LTS^)
  echo     ติดตั้งเสร็จแล้วเปิดไฟล์นี้อีกครั้ง
  echo.
  pause
  exit /b 1
)

echo [1/3] พบ Node.js:
node -v
echo.

REM --- ติดตั้ง dependency เฉพาะครั้งแรก ---
if not exist "node_modules" (
  echo [2/3] ติดตั้ง dependencies ครั้งแรก... ^(รอสักครู่^)
  call npm install
  if errorlevel 1 (
    echo [!] npm install ล้มเหลว - ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่
    pause
    exit /b 1
  )
) else (
  echo [2/3] dependencies พร้อมแล้ว ข้ามขั้นตอนติดตั้ง
)
echo.

echo [3/3] กำลังเปิดเซิร์ฟเวอร์...
echo     เปิดเบราว์เซอร์ไปที่:  http://localhost:3000
echo     ^(กด Ctrl+C ในหน้าต่างนี้เพื่อหยุดแอป^)
echo.

REM เปิดเบราว์เซอร์ให้อัตโนมัติหลังเซิร์ฟเวอร์เริ่ม
start "" cmd /c "timeout /t 2 >nul && start http://localhost:3000"

npm start
pause
