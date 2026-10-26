; Impacto · instalador leve para Windows 10+
; Cria o app "Impacto" que abre a plataforma (https://impacto-mu.vercel.app) numa janela própria,
; sem barra de endereço, pelo Microsoft Edge (presente em todo Windows 10 e 11) ou Google Chrome.
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"

!define APPNAME "Impacto"
!define URL "https://impacto-mu.vercel.app"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Impacto"

Name "${APPNAME}"
OutFile "Impacto-Instalador-Windows.exe"
InstallDir "$LOCALAPPDATA\Programs\Impacto"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Studio Impacto"
Icon "impacto.ico"
UninstallIcon "impacto.ico"
VIProductVersion "1.0.0.0"
VIAddVersionKey /LANG=1046 "ProductName" "Impacto"
VIAddVersionKey /LANG=1046 "CompanyName" "Studio Impacto"
VIAddVersionKey /LANG=1046 "FileDescription" "Instalador do Impacto"
VIAddVersionKey /LANG=1046 "FileVersion" "1.0.0"
VIAddVersionKey /LANG=1046 "LegalCopyright" "Studio Impacto"

!define MUI_ICON "impacto.ico"
!define MUI_UNICON "impacto.ico"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o Impacto agora"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Var BROWSER
Var ARGS

Function FindBrowser
  StrCpy $BROWSER ""
  ${If} ${FileExists} "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe"
    StrCpy $BROWSER "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe"
  ${ElseIf} ${FileExists} "$PROGRAMFILES64\Microsoft\Edge\Application\msedge.exe"
    StrCpy $BROWSER "$PROGRAMFILES64\Microsoft\Edge\Application\msedge.exe"
  ${ElseIf} ${FileExists} "$LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
    StrCpy $BROWSER "$LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
  ${ElseIf} ${FileExists} "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
    StrCpy $BROWSER "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
  ${ElseIf} ${FileExists} "$PROGRAMFILES32\Google\Chrome\Application\chrome.exe"
    StrCpy $BROWSER "$PROGRAMFILES32\Google\Chrome\Application\chrome.exe"
  ${ElseIf} ${FileExists} "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    StrCpy $BROWSER "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ${EndIf}
  StrCpy $ARGS '--app=${URL} --start-maximized'
FunctionEnd

Function LaunchApp
  ${If} $BROWSER != ""
    Exec '"$BROWSER" $ARGS'
  ${Else}
    ExecShell "open" "${URL}"
  ${EndIf}
FunctionEnd

Section "Impacto"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File "impacto.ico"
  Call FindBrowser
  ; Atalho de reserva (abre no navegador padrão) caso nenhum Edge/Chrome seja encontrado
  WriteINIStr "$INSTDIR\Impacto.url" "InternetShortcut" "URL" "${URL}"
  WriteINIStr "$INSTDIR\Impacto.url" "InternetShortcut" "IconFile" "$INSTDIR\impacto.ico"
  WriteINIStr "$INSTDIR\Impacto.url" "InternetShortcut" "IconIndex" "0"
  ${If} $BROWSER != ""
    CreateShortCut "$DESKTOP\Impacto.lnk" "$BROWSER" "$ARGS" "$INSTDIR\impacto.ico" 0 SW_SHOWMAXIMIZED "" "Impacto · Studio Impacto"
    CreateShortCut "$SMPROGRAMS\Impacto.lnk" "$BROWSER" "$ARGS" "$INSTDIR\impacto.ico" 0 SW_SHOWMAXIMIZED "" "Impacto · Studio Impacto"
  ${Else}
    CopyFiles /SILENT "$INSTDIR\Impacto.url" "$DESKTOP\Impacto.url"
    CopyFiles /SILENT "$INSTDIR\Impacto.url" "$SMPROGRAMS\Impacto.url"
  ${EndIf}
  WriteUninstaller "$INSTDIR\Desinstalar Impacto.exe"
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "Impacto"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "Studio Impacto"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\impacto.ico"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "1.0.0"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Desinstalar Impacto.exe"'
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
  IfSilent 0 +2
    Call LaunchApp
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\Impacto.lnk"
  Delete "$DESKTOP\Impacto.url"
  Delete "$SMPROGRAMS\Impacto.lnk"
  Delete "$SMPROGRAMS\Impacto.url"
  Delete "$INSTDIR\impacto.ico"
  Delete "$INSTDIR\Impacto.url"
  Delete "$INSTDIR\Desinstalar Impacto.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${REGKEY}"
SectionEnd
