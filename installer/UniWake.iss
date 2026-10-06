; UniWake installer (FR-001.1, ADR-021, ADR-022, plan section 9). Inno Setup 6.
; Built in CI:  ISCC /DAppVersion=1.2.3 installer\UniWake.iss
; after scripts/build.ts, scripts/fetch-node.ts and scripts/fetch-winsw.ts filled build\stage.
;
; Layout: {app}\UniWakeService.exe (WinSW) + UniWakeService.xml pointing at
; {app}\versions\<version>\node.exe server.mjs. The previous version directory is kept for rollback;
; older ones are removed. Data lives in %ProgramData%\UniWake and survives upgrades and uninstall
; (unless the user asks to remove it in an interactive uninstall).

#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#ifndef StageDir
  #define StageDir "..\build\stage"
#endif
#define PanelPort "47100"
#define AgentPort "47101"

[Setup]
AppId={{8F6A2C1E-5B7D-4E3A-9C2F-1D4B6A8E0F37}
AppName=UniWake
AppVersion={#AppVersion}
AppVerName=UniWake {#AppVersion}
AppPublisher=UniWake
DefaultDirName={autopf}\UniWake
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=Output
OutputBaseFilename=UniWake-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
SetupLogging=yes
UninstallDisplayName=UniWake
UninstallDisplayIcon={app}\versions\{#AppVersion}\node.exe

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "{#StageDir}\app\*"; DestDir: "{app}\versions\{#AppVersion}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\WinSW-x64.exe"; DestDir: "{app}"; DestName: "UniWakeService.exe"; Flags: ignoreversion
Source: "UniWakeService.xml"; Flags: dontcopy

[Dirs]
Name: "{commonappdata}\UniWake"; Flags: uninsneveruninstall

[INI]
; Start Menu shortcut "UniWake" opens the local panel.
Filename: "{autoprograms}\UniWake.url"; Section: "InternetShortcut"; Key: "URL"; String: "http://127.0.0.1:{#PanelPort}/"

[UninstallDelete]
Type: files; Name: "{autoprograms}\UniWake.url"
Type: filesandordirs; Name: "{app}\versions"
Type: files; Name: "{app}\UniWakeService.xml"

[UninstallRun]
Filename: "{app}\UniWakeService.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopService"
Filename: "{app}\UniWakeService.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveService"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""UniWake Painel"""; Flags: runhidden waituntilterminated; RunOnceId: "FirewallPanel"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""UniWake Cadastro"""; Flags: runhidden waituntilterminated; RunOnceId: "FirewallAgent"

[Code]
var
  PreviousVersion: String;

function Run(const Exe, Params: String): Integer;
var
  Code: Integer;
begin
  if not Exec(Exe, Params, '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Code := -1;
  Log(Format('%s %s -> %d', [Exe, Params, Code]));
  Result := Code;
end;

function ServiceExists(): Boolean;
begin
  { sc query exits 1060 when the service does not exist. }
  Result := Run(ExpandConstant('{sys}\sc.exe'), 'query UniWake') = 0;
end;

{ The version the current UniWakeService.xml points at, '' if none. }
function InstalledVersion(): String;
var
  Xml: AnsiString;
  S: String;
  P: Integer;
begin
  Result := '';
  if not LoadStringFromFile(ExpandConstant('{app}\UniWakeService.xml'), Xml) then exit;
  S := String(Xml);
  P := Pos('\versions\', S);
  if P = 0 then exit;
  S := Copy(S, P + Length('\versions\'), 64);
  P := Pos('\', S);
  if P > 0 then Result := Copy(S, 1, P - 1);
end;

{ Upgrade: stop the running version before its files are replaced (WinSW waits for the stop). }
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  PreviousVersion := InstalledVersion();
  if ServiceExists() then
    if Run(ExpandConstant('{app}\UniWakeService.exe'), 'stopwait') <> 0 then
      Result := 'O serviço UniWake não parou. Pare-o em services.msc e tente de novo.';
end;

procedure WriteServiceXml();
var
  Xml: AnsiString;
  S: String;
begin
  ExtractTemporaryFile('UniWakeService.xml');
  LoadStringFromFile(ExpandConstant('{tmp}\UniWakeService.xml'), Xml);
  S := String(Xml);
  StringChangeEx(S, '@VERSION@', '{#AppVersion}', True);
  SaveStringToFile(ExpandConstant('{app}\UniWakeService.xml'), AnsiString(S), False);
end;

procedure AddFirewallRule(const Name, Port: String);
var
  Netsh: String;
begin
  Netsh := ExpandConstant('{sys}\netsh.exe');
  Run(Netsh, 'advfirewall firewall delete rule name="' + Name + '"');
  Run(Netsh, 'advfirewall firewall add rule name="' + Name + '" dir=in action=allow protocol=TCP localport=' + Port + ' profile=domain,private');
end;

{ Keeps the installed version and the one it replaced (rollback, ADR-022); removes the rest. }
procedure PruneVersions();
var
  F: TFindRec;
  Root: String;
begin
  Root := ExpandConstant('{app}\versions\');
  if FindFirst(Root + '*', F) then
  try
    repeat
      if (F.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0) and (F.Name <> '.') and (F.Name <> '..')
        and (F.Name <> '{#AppVersion}') and (F.Name <> PreviousVersion) then
        DelTree(Root + F.Name, True, True, True);
    until not FindNext(F);
  finally
    FindClose(F);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Data: String;
begin
  if CurStep <> ssPostInstall then exit;
  Data := ExpandConstant('{commonappdata}\UniWake');
  { Data dir: SYSTEM and Administrators only (plan section 9). }
  Run(ExpandConstant('{sys}\icacls.exe'), '"' + Data + '" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F');
  WriteServiceXml();
  AddFirewallRule('UniWake Painel', '{#PanelPort}');
  AddFirewallRule('UniWake Cadastro', '{#AgentPort}');
  if ServiceExists() then
    Run(ExpandConstant('{app}\UniWakeService.exe'), 'refresh')
  else
    Run(ExpandConstant('{app}\UniWakeService.exe'), 'install');
  Run(ExpandConstant('{app}\UniWakeService.exe'), 'start');
  PruneVersions();
end;

{ Interactive uninstall may also remove the data; silent uninstall always keeps it (FR-001.1). }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and not UninstallSilent() then
    if MsgBox('Remover também os dados do UniWake (banco de dados, backups e logs em ' +
      ExpandConstant('{commonappdata}\UniWake') + ')?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(ExpandConstant('{commonappdata}\UniWake'), True, True, True);
end;
