@echo off
setlocal
title MONOCHROMIUM - Publish Desktop Update
cd /d "%~dp0"

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: Windows PowerShell could not be found.
  exit /b 1
)

net session >nul 2>nul
if errorlevel 1 (
  echo Requesting administrator permission for GitHub CLI authentication...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0release-update.ps1'; exit $p.ExitCode"
  exit /b %errorlevel%
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0release-update.ps1" %*
if errorlevel 1 (
  echo.
  echo Release failed. No source files were committed or pushed by this helper.
  pause
  exit /b 1
)

echo.
echo Release completed. Only the three updater assets were published.
pause
exit /b 0
