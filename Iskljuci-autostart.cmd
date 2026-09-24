@echo off
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v MyPhoneLibrary /f >nul 2>&1
powershell -NoProfile -Command "$p=[IO.Path]::Combine([Environment]::GetFolderPath('Startup'),'MyPhoneLibrary.lnk');if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p}"
echo Autostart MyPhoneLibrary aplikacije je iskljucen.
pause
