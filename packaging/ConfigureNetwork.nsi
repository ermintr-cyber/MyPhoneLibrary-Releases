Unicode true
!ifndef SOURCE_ROOT
!define SOURCE_ROOT "${__FILEDIR__}/.."
!endif
Name "My Phone Library network setup"
OutFile "${SOURCE_ROOT}\ConfigureNetwork.exe"
RequestExecutionLevel admin
SilentInstall silent
AutoCloseWindow true
Section
 nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="MyPhoneLibrary - TCP 9000"'
 Pop $0
 nsExec::ExecToLog 'netsh advfirewall firewall add rule name="MyPhoneLibrary - TCP 9000" dir=in action=allow program="$EXEDIR\runtime\pythonw.exe" enable=yes protocol=TCP localport=9000 remoteip=LocalSubnet,100.64.0.0/10 profile=any'
 Pop $0
 StrCmp $0 "0" done
 MessageBox MB_OK|MB_ICONEXCLAMATION "Windows could not configure network access. The library can still run locally. Check Windows Firewall settings for TCP port 9000."
 SetErrorLevel 1
 done:
SectionEnd
