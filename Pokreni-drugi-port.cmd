@echo off
setlocal
set /p "MPL_PORT=Unesite slobodan port (npr. 8092): "
call "%~dp0Pokreni-MyPhoneLibrary.cmd" --port %MPL_PORT%
endlocal
