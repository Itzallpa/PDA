@echo off
title PDA Storage Management System
cd /d "%~dp0"
echo ========================================================
echo   Starting PDA Storage Management System
echo   Local Port: 5001
echo ========================================================
echo.
start http://localhost:5001

where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
  node server.js
) else (
  where py >nul 2>nul
  if %ERRORLEVEL% equ 0 (
    py app.py
  ) else (
    python app.py
  )
)

pause
