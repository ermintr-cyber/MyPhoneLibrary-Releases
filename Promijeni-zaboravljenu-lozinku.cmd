@echo off
echo Prvo zatvorite sve pokrenute MyPhoneLibrary server prozore.
pause
"%~dp0runtime\python.exe" "%~dp0server.py" --reset-password
pause
