@echo off
setlocal
title MONOCHROMIUM - Publish Desktop Update
cd /d "%~dp0"

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: Windows PowerShell could not be found.
  exit /b 1
)

rem /nopause is a wrapper-only option; do not forward it to PowerShell.
set "PS_ARGS=%*"
set "NO_PAUSE=0"
if /i not "%PS_ARGS:/nopause=%"=="%PS_ARGS%" set "NO_PAUSE=1"
if /i not "%PS_ARGS:-nopause=%"=="%PS_ARGS%" set "NO_PAUSE=1"
set "PS_ARGS=%PS_ARGS:/dry-run=-DryRun%"
set "PS_ARGS=%PS_ARGS:-dry-run=-DryRun%"
set "PS_ARGS=%PS_ARGS:/allow-dirty=-AllowDirty%"
set "PS_ARGS=%PS_ARGS:-allow-dirty=-AllowDirty%"
set "PS_ARGS=%PS_ARGS:/skip-tests=-SkipTests%"
set "PS_ARGS=%PS_ARGS:-skip-tests=-SkipTests%"
set "PS_ARGS=%PS_ARGS:/reuse-build=-ReuseBuild%"
set "PS_ARGS=%PS_ARGS:-reuse-build=-ReuseBuild%"
set "PS_ARGS=%PS_ARGS:/ui=-Ui%"
set "PS_ARGS=%PS_ARGS:-ui=-Ui%"
set "PS_ARGS=%PS_ARGS:/repo=-Repo%"
set "PS_ARGS=%PS_ARGS:-repo=-Repo%"
set "PS_ARGS=%PS_ARGS: /nopause=%"
set "PS_ARGS=%PS_ARGS:/nopause=%"
set "PS_ARGS=%PS_ARGS: -nopause=%"
set "PS_ARGS=%PS_ARGS:-nopause=%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0release-update.ps1" %PS_ARGS%
if errorlevel 1 (
  echo.
  echo Release failed. No source files were committed or pushed by this helper.
  if "%NO_PAUSE%"=="0" pause
  exit /b 1
)

echo.
echo Release completed. Only updater assets were published; source files were not attached.
if "%NO_PAUSE%"=="0" pause
exit /b 0
