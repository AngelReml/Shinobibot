; Shinobi installer — Inno Setup script.
; Compile: ISCC.exe installer\shinobi.iss → installer\Output\ShinobiSetup-1.0.0.exe
;
; Inputs (assumed pre-built):
;   build\shinobi.exe              — SEA bundle (run `node build_sea.mjs`)
;   build\node_modules\better-sqlite3\  — required native module (best-sqlite3 binding)
;   build\node_modules\sqlite-vec\      — vector ext if used
;   build\README.md                — distributed alongside
;
; If you're missing build/, run from repo root:
;   node build_sea.mjs
;
; The CI/release pipeline (.github/workflows/release.yml) can also pick this
; .iss up: drop `iscc.exe installer\shinobi.iss` after the SEA build step and
; the resulting .exe lands in installer\Output\.

#define MyAppName "Shinobi"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "AngelReml / zapweave"
#define MyAppURL "https://zapweave.com/"
#define MyAppExeName "shinobi.exe"

[Setup]
; AppId is a stable GUID — DO NOT change between releases or upgrades won't apply cleanly.
AppId={{A2C6F1F9-9D77-4E0A-B6D2-9D62F8E2A001}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
LicenseFile=
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=Output
OutputBaseFilename=ShinobiSetup-{#MyAppVersion}
SetupIconFile=
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName} {#MyAppVersion}

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el Escritorio"; GroupDescription: "Accesos directos:"
Name: "startmenuicon"; Description: "Crear entrada en Menú Inicio"; GroupDescription: "Accesos directos:"; Flags: checkedonce
; Auto-start is OFF by default per the user contract — explicit opt-in required.
Name: "autostart"; Description: "Arrancar Shinobi al iniciar Windows (servicio en segundo plano)"; GroupDescription: "Avanzado:"; Flags: unchecked

[Files]
; Main bundle
Source: "..\build\shinobi.exe"; DestDir: "{app}"; Flags: ignoreversion
; Native modules required by the SEA bundle
Source: "..\build\node_modules\better-sqlite3\*"; DestDir: "{app}\node_modules\better-sqlite3"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "..\build\node_modules\sqlite-vec\*"; DestDir: "{app}\node_modules\sqlite-vec"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
; Docs
Source: "..\build\README.md"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
; Service installer (PowerShell wrapper)
Source: "..\scripts\install_service.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: startmenuicon
Name: "{group}\Documentación"; Filename: "{app}\README.md"; Tasks: startmenuicon
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; Optional: register as Windows service if user opted in.
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -File ""{app}\scripts\install_service.ps1"""; \
  Flags: runhidden waituntilterminated; \
  Tasks: autostart; \
  StatusMsg: "Registrando servicio Windows ShinobiDaemon..."

; Always: launch Shinobi once after install so the wizard runs
Filename: "{app}\{#MyAppExeName}"; \
  Description: "Lanzar {#MyAppName} ahora"; \
  Flags: nowait postinstall skipifsilent

[UninstallRun]
; Best-effort: stop+remove the service before uninstalling files.
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -File ""{app}\scripts\install_service.ps1"" -Uninstall"; \
  Flags: runhidden; \
  RunOnceId: "RemoveShinobiService"

[Code]
function IsServiceInstalled(): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('sc.exe', 'query ShinobiDaemon', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  // If the service is already installed and the user is upgrading, stop it
  // before we replace shinobi.exe so files aren't locked.
  if (CurStep = ssInstall) and IsServiceInstalled() then
    Exec('sc.exe', 'stop ShinobiDaemon', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function IsX64: Boolean;
begin
  Result := Is64BitInstallMode;
end;

function InitializeSetup(): Boolean;
begin
  if not IsX64 then begin
    MsgBox('Shinobi requiere Windows 64-bit.', mbError, MB_OK);
    Result := False;
  end else
    Result := True;
end;
