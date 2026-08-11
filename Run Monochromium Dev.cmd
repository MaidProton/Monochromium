@echo off
setlocal

cd /d "%~dp0"

if not exist "package.json" (
  echo Monochromium project folder was not found.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0electron\cleanup-dev-server.ps1" -ProjectRoot "%~dp0" -Port 5173
if errorlevel 1 (
  echo.
  echo Development mode was not started because port 5173 could not be cleared safely.
  pause
  exit /b 1
)

call npm.cmd run desktop:dev

echo.
echo Monochromium development mode has stopped.
pause
