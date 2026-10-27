@echo off
title Serveo Tunnel (SOCN-PDA) - Anti-Sleep Active
cd /d "%~dp0"

echo ========================================================
echo   Starting Serveo Tunnel for SOCN-PDA
echo   Domain: https://socn-pda.serveousercontent.com
echo   Key: %USERPROFILE%\.ssh\id_ed25519
echo   Anti-Sleep Keep-Alive is ACTIVATED!
echo ========================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
  node tunnel.js
) else (
  echo Using native SSH Keep-Alive loop...
  :loop
  echo [%time%] Connecting to serveo.net for SOCN-PDA...
  ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -i "%USERPROFILE%\.ssh\id_ed25519" -R SOCN-PDA:80:127.0.0.1:5001 serveo.net
  echo [%time%] Tunnel disconnected. Reconnecting in 3 seconds...
  timeout /t 3 /nobreak >nul
  goto loop
)

pause
