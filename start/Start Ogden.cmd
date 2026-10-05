@echo off
rem Start Ogden Agents on Windows. Double-click this file, or run it from a
rem Command Prompt. It needs no administrator rights and no PowerShell.
rem
rem It checks that Node.js is installed and new enough, then runs the same
rem command a terminal user types, "npx ogden-agents", which starts Ogden
rem Agents and opens it in your browser. It never installs anything itself,
rem never asks for administrator rights, and never downloads and runs a script.
rem
rem   --check   Only report what was found (Node.js, npm, the package it would
rem             run) and exit: 0 when Ogden Agents can start. Opens nothing.
rem   Any other arguments go to Ogden Agents itself (for example --no-open,
rem   --port 5000).
rem
rem Environment: OGDEN_AGENTS_DATA_DIR (where Ogden Agents keeps its data) is
rem passed through. OGDEN_AGENTS_PACKAGE overrides the package npx runs
rem (default ogden-agents@latest; for example ogden-agents@next).
rem OGDEN_START_NO_PAUSE=1 never waits for a key (for automation).
setlocal EnableExtensions DisableDelayedExpansion

rem The minimum Node.js major version: package.json "engines" (a test keeps them equal).
set "MIN_NODE_MAJOR=24"
set "NODE_DOWNLOAD_URL=https://nodejs.org/en/download"
set "OGDEN_PACKAGE=ogden-agents@latest"
if defined OGDEN_AGENTS_PACKAGE set "OGDEN_PACKAGE=%OGDEN_AGENTS_PACKAGE%"
set "OGDEN_CHECK=0"
if /i "%~1"=="--check" set "OGDEN_CHECK=1"

where node >nul 2>nul
if errorlevel 1 (
  set "OGDEN_PROBLEM=Node.js is not installed, no node command was found."
  goto :need_node
)

set "NODE_VERSION="
for /f "delims=" %%v in ('node --version 2^>nul') do if not defined NODE_VERSION set "NODE_VERSION=%%v"
if not defined NODE_VERSION set "NODE_VERSION=unknown"
set "NODE_MAJOR=%NODE_VERSION:~1%"
for /f "delims=." %%m in ("%NODE_MAJOR%.") do set "NODE_MAJOR=%%m"
echo(%NODE_MAJOR%| findstr /r /x "[0-9][0-9]*" >nul
if errorlevel 1 (
  set "OGDEN_PROBLEM=the installed Node.js did not report its version."
  goto :need_node
)
if %NODE_MAJOR% LSS %MIN_NODE_MAJOR% (
  set "OGDEN_PROBLEM=the installed Node.js is %NODE_VERSION%, which is too old."
  goto :need_node
)

where npx >nul 2>nul
if errorlevel 1 (
  set "OGDEN_PROBLEM=Node.js %NODE_VERSION% is installed, but its npx command is missing. Reinstalling Node.js brings it back."
  goto :need_node
)

if "%OGDEN_CHECK%"=="1" goto :check

echo Starting Ogden Agents with Node.js %NODE_VERSION%. The first start downloads it, which can take a minute.
call npx --yes "--package=%OGDEN_PACKAGE%" ogden %*
set "OGDEN_STATUS=%ERRORLEVEL%"
if not "%OGDEN_STATUS%"=="0" goto :launch_failed
endlocal & exit /b 0

:check
set "NPM_VERSION=not found"
for /f "delims=" %%v in ('npm --version 2^>nul') do set "NPM_VERSION=%%v"
set "OGDEN_DATA=the default for this computer"
if defined OGDEN_AGENTS_DATA_DIR set "OGDEN_DATA=%OGDEN_AGENTS_DATA_DIR%"
echo Node.js: %NODE_VERSION%
echo npm: %NPM_VERSION%
echo Package: %OGDEN_PACKAGE%
echo Data folder: %OGDEN_DATA%
echo Ready: Ogden Agents can start.
endlocal & exit /b 0

:need_node
echo.
echo Ogden Agents can't start yet: %OGDEN_PROBLEM%
echo.
echo Ogden Agents needs Node.js %MIN_NODE_MAJOR% or later. To install it:
echo   1. Go to %NODE_DOWNLOAD_URL%
echo   2. Download and run the Windows Installer, the .msi file. The LTS version is fine.
echo   3. Close this window, then double-click Start Ogden again.
echo.
echo Nothing was installed or changed on your computer.
if "%OGDEN_CHECK%"=="1" goto :need_node_exit
echo Opening the Node.js download page in your browser: %NODE_DOWNLOAD_URL%
start "" "%NODE_DOWNLOAD_URL%"
call :pause_on_error
:need_node_exit
endlocal & exit /b 1

:launch_failed
echo.
echo Ogden Agents did not start (exit code %OGDEN_STATUS%). The messages above say why.
echo Check your internet connection for the first start, then try again.
call :pause_on_error
endlocal & exit /b %OGDEN_STATUS%

:pause_on_error
if "%OGDEN_CHECK%"=="1" exit /b 0
if "%OGDEN_START_NO_PAUSE%"=="1" exit /b 0
echo.
pause
exit /b 0
