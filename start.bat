@echo off
title PDA Storage Management System (Python Flask)
cd /d "%~dp0"
echo ========================================================
echo   Starting PDA Storage Management System (Python Flask)
echo   Local Port: 5001
echo ========================================================
echo.
start http://localhost:5001

where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
  py app.py
) else (
  python app.py
)

pause
