@echo off
REM AutoLien Operator launcher.
REM Double-click this file to start the operator app.
cd /d "%~dp0"
echo Starting AutoLien Operator...
call npx --yes electron .
if errorlevel 1 (
  echo.
  echo Operator exited with an error. Press any key to close.
  pause >nul
)
