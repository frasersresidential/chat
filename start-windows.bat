@echo off
REM ============================================================
REM  OmniChat - One-click launcher for Windows
REM  ดับเบิลคลิกไฟล์นี้เพื่อรันแอป (ครั้งแรกจะติดตั้ง dependency ให้อัตโนมัติ)
REM  หน้าต่างนี้จะ "ค้างไว้เสมอ" แม้เกิด error เพื่อให้อ่านข้อความได้
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
  echo [X] ไม่พบ Node.js บนเครื่องนี้
  echo     ติดตั้งก่อนที่ https://nodejs.org  ^(เลือก LTS^) แล้วรีสตาร์ทเครื่อง
  goto :hold
)
echo [1/3] Node.js:
call node -v
echo.

REM --- ตรวจว่ามีไฟล์โปรเจกต์จริงไหม (กันรันผิดโฟลเดอร์) ---
if not exist "package.json" (
  echo [X] ไม่พบ package.json ในโฟลเดอร์นี้
  echo     แสดงว่าวางไฟล์ .bat ผิดที่ หรือยังไม่ได้แตก ZIP
  echo     โฟลเดอร์ปัจจุบัน: %CD%
  goto :hold
)

REM --- ติดตั้ง dependency เฉพาะครั้งแรก ---
if not exist "node_modules" (
  echo [2/3] ติดตั้ง dependencies ครั้งแรก... รอ 1-2 นาที
  call npm install
  if errorlevel 1 (
    echo.
    echo [X] npm install ล้มเหลว - ตรวจอินเทอร์เน็ตแล้วลองใหม่ ^(ข้อความ error อยู่ด้านบน^)
    goto :hold
  )
) else (
  echo [2/3] dependencies พร้อมแล้ว
)
echo.

echo [3/3] กำลังเปิดเซิร์ฟเวอร์... เปิดเบราว์เซอร์ที่ http://localhost:3000
echo     ^(หน้าต่างนี้ต้องเปิดค้างไว้ - กด Ctrl+C เพื่อหยุดแอป^)
echo.

REM เปิดเบราว์เซอร์หลังเซิร์ฟเวอร์พร้อม (รอ 4 วินาที)
start "" cmd /c "timeout /t 4 >nul && start http://localhost:3000"

REM ใช้ call เพื่อให้กลับมาที่ :hold ได้แม้เซิร์ฟเวอร์ดับ (เดิมเป็นบั๊ก: ไม่ได้ใส่ call ทำให้หน้าต่างปิดหนีตอน error)
call npm start

echo.
echo [X] เซิร์ฟเวอร์หยุดทำงาน - ข้อความ error อยู่ด้านบน
:hold
echo.
echo ============================================
echo  กดปุ่มใดก็ได้เพื่อปิดหน้าต่างนี้...
echo ============================================
pause >nul
