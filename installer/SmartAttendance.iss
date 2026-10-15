; Smart Attendance — Inno Setup script.
;
; Compile it with build.ps1 (recommended), or open this file in the Inno Setup
; Compiler and press F9 after setting the SETUP_PASSWORD environment variable.
;
;   $env:SETUP_PASSWORD = 'the password the other device will type'
;   & 'C:\Program Files\Inno Setup 7\ISCC.exe' .\SmartAttendance.iss
;
; The staged tree comes from prepare.ps1: runtime\ is a self-contained Python,
; app\backend\ is the service including your .env, and app\web\ is the built
; front end. Nothing here reads your keys; the files are only copied.

#define MyAppName "Smart Attendance"
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#define MyAppPublisher "Smart Attendance System"
#define MyAppURL "http://localhost:8766"
#define Staged "build"

; The setup is encrypted, so the .env inside it is unreadable without this
; password. It is never written into this file, because this file is in git. It
; comes from one of two places:
;
;   1. the SETUP_PASSWORD environment variable (what build.ps1 uses), or
;   2. installer\password.ini, which the Inno Setup Compiler window can read on
;      its own — copy password.ini.example and fill it in.
;
; Without either the build stops, rather than shipping your service-role key
; unencrypted.
#define EnvPassword ReadEnv("SETUP_PASSWORD")
#define IniPassword Trim(ReadIni(AddBackslash(SourcePath) + "password.ini", "setup", "password", ""))
#if EnvPassword == ""
  #if IniPassword == ""
    #error No installer password. Either run build.ps1, or copy password.ini.example to password.ini in this folder and set password=your password on the second line.
  #else
    #define SetupPassword IniPassword
  #endif
#else
  #define SetupPassword EnvPassword
#endif

[Setup]
AppId={{8E4C1D7A-2B5F-4C63-9A1E-5D7F0C2B8A41}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\SmartAttendance
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
DisableWelcomePage=no
OutputDir=Output
OutputBaseFilename=SmartAttendance-{#MyAppVersion}-Setup
SetupIconFile=
Compression=lzma2/max
SolidCompression=yes
Encryption=yes
Password={#SetupPassword}
MinVersion=10.0
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
PrivilegesRequired=admin
; A school machine that will not give out admin rights can still take a per-user
; install, which lands under the signed-in user's own AppData. That is also the
; only way the "start at sign-in" entry below can apply to the right person.
PrivilegesRequiredOverridesAllowed=dialog
UsedUserAreasWarning=no
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\runtime\python.exe
UninstallDisplayName={#MyAppName}
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"
Name: "startup"; Description: "Start the scanner service when this user signs in"; GroupDescription: "Startup:"; Flags: unchecked

[Files]
Source: "{#Staged}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Staged}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
; schema.sql is the one file an admin may want to re-run in Supabase Studio
; without opening an archive, so it is also dropped next to the shortcuts.
Source: "{#Staged}\app\backend\schema.sql"; DestDir: "{group}"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\runtime\python.exe"; Parameters: """{app}\app\backend\main.py"" --open"; WorkingDir: "{app}"; Comment: "Runs the scanner service and opens the app"
Name: "{group}\Open the app"; Filename: "{#MyAppURL}"; Comment: "Only works while the service is running"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\runtime\python.exe"; Parameters: """{app}\app\backend\main.py"" --open"; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
; pythonw.exe so no console window pops up at sign-in. Use this or the shortcut,
; not both: two services would both answer the same scanner.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "SmartAttendance"; ValueData: """{app}\runtime\pythonw.exe"" ""{app}\app\backend\main.py"""; Tasks: startup; Flags: uninsdeletevalue

[Run]
Filename: "{app}\runtime\python.exe"; Parameters: """{app}\app\backend\main.py"" --open"; WorkingDir: "{app}"; Description: "Start {#MyAppName} now"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app\backend\__pycache__"
Type: files; Name: "{app}\app\backend\demo_data.json"
Type: files; Name: "{app}\app\backend\service.log"

[Code]
// The scanner is useless without the vendor SDK, and the SDK cannot be bundled
// here: it installs its own driver. Say so once, after the files land.
function SdkInstalled(): Boolean;
begin
  Result :=
    FileExists(ExpandConstant('{win}\System32\libzkfp.dll')) or
    FileExists(ExpandConstant('{win}\SysWOW64\libzkfp.dll'));
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep <> ssPostInstall then Exit;
  if SdkInstalled() then Exit;

  MsgBox(
    'The ZKFinger SDK was not found on this computer.' + #13#10 + #13#10 +
    'Install it before plugging in the Live20R, or the service will run without ' +
    'a scanner. It comes from ZKTeco as "ZKFinger SDK (Windows Standard)"; after ' +
    'installing it, restart this computer and check that the device appears in ' +
    'Windows Device Manager.',
    mbInformation, MB_OK);
end;
