Unicode true
!ifndef SOURCE_ROOT
!define SOURCE_ROOT "${__FILEDIR__}/.."
!endif
!include "MUI2.nsh"
!include "x64.nsh"
!ifndef VERSION
!define VERSION "1.15.0"
!endif
Var WasRunning
Name "My Phone Library"
OutFile "${SOURCE_ROOT}\dist\MyPhoneLibrary_Setup_${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\MyPhoneLibrary"
InstallDirRegKey HKCU "Software\MyPhoneLibrary" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "Install My Phone Library on this computer.$\r$\n$\r$\nYour collection, photos and settings are stored separately and preserved when updating or uninstalling.$\r$\n$\r$\nA running Toolbox-managed Phone server is stopped and restarted automatically."
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
 StrCpy $WasRunning "0"
 ${IfNot} ${RunningX64}
  IfSilent unsupported
  MessageBox MB_OK|MB_ICONSTOP "My Phone Library requires 64-bit Windows."
 unsupported:
  SetErrorLevel 2
  Abort
 ${EndIf}
 IfFileExists "$INSTDIR\runtime\pythonw.exe" 0 ready
 InitPluginsDir
 File /oname=$PLUGINSDIR\stop_for_install.py "${SOURCE_ROOT}\packaging\stop_for_install.py"
 ExecWait '"$INSTDIR\runtime\pythonw.exe" "$PLUGINSDIR\stop_for_install.py" --root "$INSTDIR"' $0
 StrCmp $0 "10" stopped
 StrCmp $0 "0" ready
 IfSilent stop_failed
 MessageBox MB_OK|MB_ICONSTOP "My Phone Library could not stop safely. Nothing was overwritten. See MyPhoneLibrary/installer-stop.log in Local AppData, then retry."
 stop_failed:
 SetErrorLevel 2
 Abort
 stopped:
 StrCpy $WasRunning "1"
 ready:
FunctionEnd
Function .onInstSuccess
 ${If} $WasRunning == "1"
  Exec '"$INSTDIR\MyPhoneLibrary.exe" --no-browser'
 ${EndIf}
FunctionEnd
Function .onInstFailed
 ${If} $WasRunning == "1"
  Exec '"$INSTDIR\MyPhoneLibrary.exe" --no-browser'
 ${EndIf}
FunctionEnd
Section "Application"
 SetOutPath "$INSTDIR"
 File "${SOURCE_ROOT}\server.py"
 File "${SOURCE_ROOT}\toolbox_bridge.py"
 File "${SOURCE_ROOT}\battery_catalog.py"
 SetOutPath "$INSTDIR\data"
 File "${SOURCE_ROOT}\data\nokia-batteries.json"
 SetOutPath "$INSTDIR"
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
 ExecShellWait "open" "$INSTDIR\ConfigureNetwork.exe" "/QUIET"
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
 Delete "$INSTDIR\toolbox_bridge.py"
 Delete "$INSTDIR\battery_catalog.py"
 Delete "$INSTDIR\data\nokia-batteries.json"
 RMDir "$INSTDIR\data"
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
