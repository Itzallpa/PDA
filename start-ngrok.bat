@echo off
title PDA Storage Tunnel (Ngrok)
cd /d "%~dp0"

echo ========================================================
echo   Starting Ngrok Tunnel for PDA Storage
echo   Port: 5001 (Bypasses Firewall via Port 443)
echo ========================================================
echo.

:: Check ngrok
where ngrok >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo [ERROR] ngrok is not installed or not in PATH!
  echo Please install ngrok or place ngrok.exe in this folder.
  pause
  exit /b 1
)

:: Check for .env file
set NGROK_DOMAIN=
if exist .env (
  for /f "usebackq tokens=1,2 delims==" %%A in (".env") do (
    if "%%A"=="NGROK_DOMAIN" set NGROK_DOMAIN=%%B
  )
)

if "%NGROK_DOMAIN%"=="" (
  echo Starting ngrok on port 5001...
  echo (Note: If you have a free static domain, specify it in .env as NGROK_DOMAIN=your-domain.ngrok-free.app)
  echo.
  ngrok http 5001
) else (
  echo Starting ngrok with custom static domain: %NGROK_DOMAIN%
  echo.
  ngrok http --domain=%NGROK_DOMAIN% 5001
)

pause
