@echo off
setlocal EnableExtensions DisableDelayedExpansion
title MONOCHROMIUM - Release Tool

set "ROOT=%~dp0"
set "OUTPUT_DIR=%ROOT%out\make\squirrel.windows\x64"
set "PAUSE_ON_EXIT=1"
set "DRY_RUN_MODE=0"
set "REUSE_MODE=0"
set "MENU_MODE=0"
if /i "%~1"=="/nopause" set "PAUSE_ON_EXIT=0"
if /i "%~1"=="-nopause" set "PAUSE_ON_EXIT=0"
if /i "%~2"=="/nopause" set "PAUSE_ON_EXIT=0"
if /i "%~2"=="-nopause" set "PAUSE_ON_EXIT=0"
if /i "%~3"=="/nopause" set "PAUSE_ON_EXIT=0"
if /i "%~3"=="-nopause" set "PAUSE_ON_EXIT=0"
cd /d "%ROOT%" || goto :fatal

if /i "%~1"=="/help" goto :help
if /i "%~1"=="-help" goto :help
if /i "%~1"=="/?" goto :help
if /i "%~1"=="/gui" goto :launch_gui
if /i "%~1"=="-gui" goto :launch_gui
if /i "%~1"=="/publish" goto :publish
if /i "%~1"=="-publish" goto :publish
if /i "%~1"=="/resume" goto :resume
if /i "%~1"=="-resume" goto :resume
if /i "%~1"=="/build" goto :build
if /i "%~1"=="-build" goto :build
if /i "%~1"=="/dry-run" goto :dry_run
if /i "%~1"=="-dry-run" goto :dry_run
if /i "%~1"=="/menu" goto :menu
if /i "%~1"=="-menu" goto :menu
if not "%~1"=="" goto :help

rem Double-click keeps the friendly Tk UI. If Python/Tkinter is unavailable,
rem fall back to the native menu so the release helper is still usable.
:launch_gui
if not exist "%ROOT%release_gui.pyw" (
  echo ERROR: release_gui.pyw is missing from the project folder.
  goto :menu
)
where pythonw.exe >nul 2>nul
if errorlevel 1 goto :menu

rem A console Python can cheaply confirm that Tkinter is installed. Some
rem machines expose pythonw.exe without the standard-library Tk component.
where python.exe >nul 2>nul
if not errorlevel 1 (
  python.exe -c "import tkinter" >nul 2>nul
  if errorlevel 1 goto :menu
)

start "" /b pythonw.exe "%ROOT%release_gui.pyw"
if errorlevel 1 (
  echo ERROR: Could not start the release GUI.
  goto :menu
)
exit /b 0

:menu
set "MENU_MODE=1"
echo.
echo ============================================================
echo  MONOCHROMIUM RELEASE TOOL
echo ============================================================
echo.
echo  [1] Build and publish update (full parallel checks)
echo  [2] Build installer only (fast, no tests)
echo  [3] Publish existing installer output (no rebuild)
echo  [4] Dry-run the next publish
echo  [5] Open installer output folder
echo  [Q] Quit
echo.
choice /c 12345Q /n /m "Choose an action: "
if errorlevel 6 goto :done
if errorlevel 5 goto :open_output
if errorlevel 4 goto :dry_run
if errorlevel 3 goto :resume
if errorlevel 2 goto :build
if errorlevel 1 goto :publish
goto :done

:publish
set "PS_ARGS="
if "%MENU_MODE%"=="1" goto :run_publish
goto :parse_publish_args

:parse_publish_args
if "%~1"=="" goto :run_publish
if /i "%~1"=="/publish" (
  shift
  goto :parse_publish_args
)
if /i "%~1"=="-publish" (
  shift
  goto :parse_publish_args
)
if /i "%~1"=="/skip-tests" (
  set "PS_ARGS=%PS_ARGS% -SkipTests"
  shift
  goto :parse_publish_args
)
if /i "%~1"=="-skip-tests" (
  set "PS_ARGS=%PS_ARGS% -SkipTests"
  shift
  goto :parse_publish_args
)
if /i "%~1"=="/allow-dirty" (
  set "PS_ARGS=%PS_ARGS% -AllowDirty"
  shift
  goto :parse_publish_args
)
if /i "%~1"=="-allow-dirty" (
  set "PS_ARGS=%PS_ARGS% -AllowDirty"
  shift
  goto :parse_publish_args
)
if /i "%~1"=="/dry-run" (
  set "DRY_RUN_MODE=1"
  set "PS_ARGS=%PS_ARGS% -DryRun"
  shift
  goto :parse_publish_args
)
if /i "%~1"=="-dry-run" (
  set "DRY_RUN_MODE=1"
  set "PS_ARGS=%PS_ARGS% -DryRun"
  shift
  goto :parse_publish_args
)
if /i "%~1"=="/reuse-build" (
  set "REUSE_MODE=1"
  set "PS_ARGS=%PS_ARGS% -ReuseBuild"
  shift
  goto :parse_publish_args
)
if /i "%~1"=="-reuse-build" (
  set "REUSE_MODE=1"
  set "PS_ARGS=%PS_ARGS% -ReuseBuild"
  shift
  goto :parse_publish_args
)
if /i "%~1"=="/nopause" (
  set "PAUSE_ON_EXIT=0"
  shift
  goto :parse_publish_args
)
if /i "%~1"=="-nopause" (
  set "PAUSE_ON_EXIT=0"
  shift
  goto :parse_publish_args
)
if /i "%~1"=="/repo" goto :parse_repo
if /i "%~1"=="-repo" goto :parse_repo
echo ERROR: Unknown publish option: %~1
call :finish 2
exit /b 2

:parse_repo
if "%~2"=="" (
  echo ERROR: /repo requires OWNER/REPOSITORY.
  call :finish 2
  exit /b 2
)
set "PS_ARGS=%PS_ARGS% -Repo %~2"
shift
shift
goto :parse_publish_args

:run_publish
call :find_powershell
if errorlevel 1 (
  call :finish 1
  exit /b 1
)
echo.
echo Starting the Monochromium release publisher...
%PS_COMMAND% -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%release-update.ps1" %PS_ARGS%
set "EXIT_CODE=%errorlevel%"
if "%EXIT_CODE%"=="0" (
  echo.
  if "%DRY_RUN_MODE%"=="1" (
    echo Dry run completed. No files were changed or published.
  ) else if "%REUSE_MODE%"=="1" (
    echo Release completed from the existing installer output.
  ) else (
    echo Release completed. Only updater artifacts were published.
  )
) else (
  echo.
  echo Release failed. Existing source files were not committed or pushed.
)
call :finish %EXIT_CODE%
exit /b %EXIT_CODE%

:resume
if /i "%~2"=="/nopause" set "PAUSE_ON_EXIT=0"
if /i "%~2"=="-nopause" set "PAUSE_ON_EXIT=0"
set "PS_ARGS=-ReuseBuild"
set "REUSE_MODE=1"
goto :run_publish

:dry_run
if /i "%~2"=="/nopause" set "PAUSE_ON_EXIT=0"
if /i "%~2"=="-nopause" set "PAUSE_ON_EXIT=0"
set "DRY_RUN_MODE=1"
set "PS_ARGS=-DryRun"
goto :run_publish

:build
set "BUILD_TESTS=0"
if "%MENU_MODE%"=="1" goto :run_build
goto :parse_build_args

:parse_build_args
if "%~1"=="" goto :run_build
if /i "%~1"=="/build" (
  shift
  goto :parse_build_args
)
if /i "%~1"=="-build" (
  shift
  goto :parse_build_args
)
if /i "%~1"=="/tests" (
  set "BUILD_TESTS=1"
  shift
  goto :parse_build_args
)
if /i "%~1"=="-tests" (
  set "BUILD_TESTS=1"
  shift
  goto :parse_build_args
)
if /i "%~1"=="/nopause" (
  set "PAUSE_ON_EXIT=0"
  shift
  goto :parse_build_args
)
if /i "%~1"=="-nopause" (
  set "PAUSE_ON_EXIT=0"
  shift
  goto :parse_build_args
)
echo ERROR: Unknown build option: %~1
call :finish 2
exit /b 2

:run_build
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js and npm could not be found on PATH.
  echo Install Node.js 22 or newer, restart Windows, and try again.
  call :finish 1
  exit /b 1
)
if "%BUILD_TESTS%"=="1" (
  echo Running typecheck and application tests in parallel...
  call npm.cmd run release:checks:app
  if errorlevel 1 goto :build_failed
)
echo Building the installer with the one-pass bundler...
call npm.cmd run desktop:make:fast
if errorlevel 1 goto :build_failed
if "%BUILD_TESTS%"=="1" (
  echo Running the compiled server smoke test...
  call npm.cmd run test:server
  if errorlevel 1 goto :build_failed
)
echo.
echo Installer ready:
echo %OUTPUT_DIR%\Monochromium-Setup.exe
call :finish 0
exit /b 0

:build_failed
echo.
echo Build failed. Review the error messages above.
call :finish 1
exit /b 1

:open_output
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%" >nul 2>nul
start "" "%OUTPUT_DIR%"
goto :done

:find_powershell
set "PS_COMMAND="
where pwsh.exe >nul 2>nul
if not errorlevel 1 set "PS_COMMAND=pwsh.exe"
if not defined PS_COMMAND (
  where powershell.exe >nul 2>nul
  if not errorlevel 1 set "PS_COMMAND=powershell.exe"
)
if not defined PS_COMMAND (
  echo ERROR: PowerShell could not be found on PATH.
  exit /b 1
)
exit /b 0

:help
echo.
echo RELEASE_MONOCHROMIUM.bat
echo.
echo Double-click: open the graphical release tool.
echo /menu: show the native menu.
echo /publish [/skip-tests] [/allow-dirty] [/repo OWNER/REPOSITORY]
echo /build [/tests]     build the current version without publishing.
echo /resume             publish the existing next-version build output.
echo /dry-run            preview the next release without changing files.
echo /gui                explicitly open the graphical tool.
echo /nopause            do not wait at the end of a direct command.
call :finish 0
exit /b 0

:fatal
echo ERROR: Could not change to the Monochromium project folder.
call :finish 1
exit /b 1

:done
exit /b 0

:finish
set "FINISH_CODE=%~1"
if "%PAUSE_ON_EXIT%"=="1" pause
exit /b %FINISH_CODE%
