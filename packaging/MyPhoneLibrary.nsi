Unicode true
!ifndef SOURCE_ROOT
!define SOURCE_ROOT "${__FILEDIR__}/.."
!endif
!include "MUI2.nsh"
!include "x64.nsh"
!ifndef VERSION
!define VERSION "1.8.1"
!endif
Name "My Phone Library"
OutFile "${SOURCE_ROOT}\dist\MyPhoneLibrary_Setup_${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\MyPhoneLibrary"
InstallDirRegKey HKCU "Software\MyPhoneLibrary" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "Install My Phone Library on this computer.$\r$\n$\r$\nYour collection, photos and settings are stored separately and preserved when updating or uninstalling.$\r$\n$\r$\nStop the server in Settings > Maintenance before continuing."
!insertmacro MUI_PAGE_WELCOME
; Stable install path preserves the firewall program rule.
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\MyPhoneLibrary.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open My Phone Library"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Function .onInit
 ${IfNot} ${RunningX64}
  MessageBox MB_OK|MB_ICONSTOP "My Phone Library requires 64-bit Windows."
  Abort
 ${EndIf}
 nsExec::ExecToStack "powershell.exe -NoProfile -NonInteractive -Command $\"try { foreach($$base in @($$env:ProgramData,$$env:LOCALAPPDATA)) { $$f=Join-Path $$base 'MyPhoneLibrary\server-running.json'; if(Test-Path $$f) { $$r=Get-Content -Raw $$f|ConvertFrom-Json; $$p=Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$$r.pid); if($$p -and $$p.CommandLine -match 'MyPhoneLibrary') { exit 1 } } }; exit 0 } catch { exit 2 }$\""
 Pop $0
 Pop $1
 StrCmp $0 "0" ready
 MessageBox MB_OK|MB_ICONSTOP "Stop MyPhoneLibrary in Settings > Maintenance before installing. If it is already closed, restart Windows and try again. Your collection will be preserved."
 Abort
 ready:
FunctionEnd
Section "Application"
 SetOutPath "$INSTDIR"
 File "${SOURCE_ROOT}\server.py"
 File "${SOURCE_ROOT}\updater.py"
 File "${SOURCE_ROOT}\app-manifest.json"
 File "${SOURCE_ROOT}\MyPhoneLibrary.exe"
 File "${SOURCE_ROOT}\ConfigureNetwork.exe"
 File "${SOURCE_ROOT}\Pokreni-MyPhoneLibrary.cmd"
 File "${SOURCE_ROOT}\Start-MyPhoneLibrary.cmd"
 File "${SOURCE_ROOT}\PROCITAJ-ME.md"
 File "${SOURCE_ROOT}\THIRD-PARTY.md"
 SetOutPath "$INSTDIR\web"
 File /r "${SOURCE_ROOT}\web\*"
 SetOutPath "$INSTDIR\runtime"
 File /r "${SOURCE_ROOT}\runtime\*"
 SetOutPath "$INSTDIR"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 WriteRegStr HKCU "Software\MyPhoneLibrary" "InstallDir" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyPhoneLibrary" "DisplayName" "My Phone Library"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyPhoneLibrary" "DisplayVersion" "${VERSION}"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyPhoneLibrary" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
 CreateDirectory "$SMPROGRAMS\My Phone Library"
 CreateShortcut "$SMPROGRAMS\My Phone Library\My Phone Library.lnk" "$INSTDIR\MyPhoneLibrary.exe"
 CreateShortcut "$SMPROGRAMS\My Phone Library\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
 CreateShortcut "$DESKTOP\My Phone Library.lnk" "$INSTDIR\MyPhoneLibrary.exe"
 ; Register the background launcher for this Windows user's sign-in.
 Delete "$SMSTARTUP\MyPhoneLibrary.lnk"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MyPhoneLibrary" '$\"$INSTDIR\MyPhoneLibrary.exe$\" --no-browser'

 System::Call 'Kernel32::SetEnvironmentVariable(t "MPL_FIREWALL_PROGRAM", t "$INSTDIR\runtime\pythonw.exe")i.r0'
 nsExec::ExecToStack "powershell.exe -NoProfile -NonInteractive -Command $\"try { $$r=Get-NetFirewallRule -DisplayName 'MyPhoneLibrary - TCP 9000' -ErrorAction Stop; $$p=$$r|Get-NetFirewallApplicationFilter; $$f=$$r|Get-NetFirewallPortFilter; if(($$r.Enabled -contains 'True') -and ($$r.Action -contains 'Allow') -and ($$p.Program -contains $$env:MPL_FIREWALL_PROGRAM) -and ($$f.LocalPort -contains '9000')) { exit 0 }; exit 1 } catch { exit 1 }$\""
 Pop $0
 Pop $1
 StrCmp $0 "0" network_ready
 ExecShellWait "open" "$INSTDIR\ConfigureNetwork.exe"
 network_ready:

SectionEnd
Section "Uninstall"
 DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MyPhoneLibrary"
 Delete "$SMSTARTUP\MyPhoneLibrary.lnk"
 Delete "$DESKTOP\My Phone Library.lnk"
 Delete "$SMPROGRAMS\My Phone Library\My Phone Library.lnk"
 Delete "$SMPROGRAMS\My Phone Library\Uninstall.lnk"
 RMDir "$SMPROGRAMS\My Phone Library"
 Delete "$INSTDIR\server.py"
 Delete "$INSTDIR\updater.py"
 Delete "$INSTDIR\app-manifest.json"
 Delete "$INSTDIR\MyPhoneLibrary.exe"
 Delete "$INSTDIR\ConfigureNetwork.exe"
 Delete "$INSTDIR\Pokreni-MyPhoneLibrary.cmd"
 Delete "$INSTDIR\Start-MyPhoneLibrary.cmd"
 Delete "$INSTDIR\PROCITAJ-ME.md"
 Delete "$INSTDIR\THIRD-PARTY.md"
 RMDir /r "$INSTDIR\web"
 RMDir /r "$INSTDIR\runtime"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
 DeleteRegKey HKCU "Software\MyPhoneLibrary"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MyPhoneLibrary"
SectionEnd
