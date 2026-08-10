@echo off
setlocal
title MONOCHROMIUM - Build Desktop Update
cd /d "%~dp0"

echo ============================================================
echo  MONOCHROMIUM - DESKTOP UPDATE BUILDER
echo ============================================================
echo.

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js and npm could not be found.
  echo Install Node.js, restart Windows, and try this file again.
  echo.
  pause
  exit /b 1
)

echo This will increase the patch version and build a new installer.
echo Example: 1.0.0 becomes 1.0.1.
echo.
call npm.cmd run desktop:release:patch

if errorlevel 1 (
  echo.
  echo ============================================================
  echo  BUILD FAILED
  echo ============================================================
  echo Review the error messages above. No installer was completed.
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  UPDATE INSTALLER READY
echo ============================================================
echo Send this file to the player:
echo.
echo %~dp0out\make\squirrel.windows\x64\Monochromium-Setup.exe
echo.
pause
exit /b 0
