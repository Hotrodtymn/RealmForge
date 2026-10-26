@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%..\.."
if defined REALMFORGE_PROJECT_ROOT set "PROJECT_ROOT=%REALMFORGE_PROJECT_ROOT%"
where node >nul 2>&1 || (
  echo Node.js was not found on PATH. Install a compatible Node.js runtime and try again.
  exit /b 1
)
node "%SCRIPT_DIR%realmforge.cjs" %* "%PROJECT_ROOT%"
exit /b %ERRORLEVEL%
