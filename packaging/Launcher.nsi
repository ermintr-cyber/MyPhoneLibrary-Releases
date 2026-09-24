Unicode true
!ifndef SOURCE_ROOT
!define SOURCE_ROOT "${__FILEDIR__}/.."
!endif
Name "My Phone Library"
OutFile "${SOURCE_ROOT}\MyPhoneLibrary.exe"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
!include "FileFunc.nsh"
Section
 SetOutPath "$EXEDIR"
 ${GetParameters} $0
 ExecWait '"$EXEDIR\runtime\pythonw.exe" "$EXEDIR\updater.py" $0' $1
 StrCmp $1 0 launch
 MessageBox MB_OK|MB_ICONEXCLAMATION "The update could not be applied. Use Settings > Maintenance > Stop server, then try again."
 Quit
 launch:
 Exec '"$EXEDIR\runtime\pythonw.exe" "$EXEDIR\server.py" $0'
SectionEnd
