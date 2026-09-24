Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!ifndef SOURCE_ROOT
!define SOURCE_ROOT "${__FILEDIR__}/.."
!endif
!ifndef VERSION
!define VERSION "1.14.0"
!endif
Name "My Libraries"
OutFile "${SOURCE_ROOT}\dist\MyLibraries_Setup_${VERSION}.exe"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
!define MUI_WELCOMEPAGE_TEXT "Choose My Media Library, My Phone Library, or both.$\r$\n$\r$\nBoth Windows installers are included. No download is needed.$\r$\n$\r$\nClose running library servers before reinstalling. Existing collections stay in their separate ProgramData folders."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"
Section "My Media Library 3.23.2" Media
 InitPluginsDir
 SetOutPath "$PLUGINSDIR"
 File /oname=media.exe "${SOURCE_ROOT}\bundle\media.exe"
 ExecWait '"$PLUGINSDIR\media.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-' $0
 ${If} $0 != 0
  ${AndIf} $0 != 3010
  SetErrorLevel $0
  MessageBox MB_OK|MB_ICONSTOP "My Media Library installation failed (code $0)."
  Abort
 ${EndIf}
SectionEnd
Section "My Phone Library ${VERSION}" Phone
 InitPluginsDir
 SetOutPath "$PLUGINSDIR"
 File /oname=phone.exe "${SOURCE_ROOT}\dist\MyPhoneLibrary_Setup_${VERSION}.exe"
 ExecWait '"$PLUGINSDIR\phone.exe" /S' $0
 ${If} $0 != 0
  SetErrorLevel $0
  MessageBox MB_OK|MB_ICONSTOP "My Phone Library installation failed (code $0). Stop its server and try again."
  Abort
 ${EndIf}
SectionEnd
Function .onInit
 ${GetParameters} $R0
 ClearErrors
 ${GetOptions} $R0 "/PHONE_ONLY" $R1
 ${IfNot} ${Errors}
  SectionSetFlags ${Media} 0
 ${EndIf}
 ClearErrors
 ${GetOptions} $R0 "/MEDIA_ONLY" $R1
 ${IfNot} ${Errors}
  SectionSetFlags ${Phone} 0
 ${EndIf}
FunctionEnd
