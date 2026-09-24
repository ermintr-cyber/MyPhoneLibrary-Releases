@echo off
powershell -NoProfile -Command "$p=[IO.Path]::Combine([Environment]::GetFolderPath('Startup'),'MyPhoneLibrary.lnk');if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p}"
echo Autostart MyPhoneLibrary aplikacije je iskljucen.
pause
