@echo off
setlocal
set "MPL_APP_DIR=%~dp0"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([IO.Path]::Combine([Environment]::GetFolderPath('Startup'),'MyPhoneLibrary.lnk'));$s.TargetPath=[IO.Path]::Combine($env:MPL_APP_DIR,'MyPhoneLibrary.exe');$s.Arguments='--no-browser';$s.WorkingDirectory=$env:MPL_APP_DIR;$s.WindowStyle=7;$s.Save()"
if errorlevel 1 (echo Autostart nije postavljen.) else (echo MyPhoneLibrary ce se pokrenuti pri sljedecoj prijavi u Windows.)
pause
endlocal
