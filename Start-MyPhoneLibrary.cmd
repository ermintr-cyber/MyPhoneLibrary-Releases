@echo off
setlocal
if exist "%~dp0MyPhoneLibrary.exe" (
  start "" "%~dp0MyPhoneLibrary.exe" %*
  exit /b 0
)
title MyPhoneLibrary
cd /d "%~dp0"
if not exist "%~dp0runtime\python.exe" (
  echo Runtime missing. Extract the complete ZIP before starting.
  pause
  exit /b 1
)
"%~dp0runtime\python.exe" "%~dp0updater.py"
if errorlevel 1 (
  pause
  exit /b 1
)
"%~dp0runtime\python.exe" "%~dp0server.py" %*
if errorlevel 1 pause
endlocal
