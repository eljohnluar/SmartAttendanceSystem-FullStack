; Smart Attendance — Inno Setup script.
;
; Compile it with build.ps1 (recommended), or open this file in the Inno Setup
; Compiler and press F9. No password is needed for either:
;
;   & 'C:\Program Files\Inno Setup 7\ISCC.exe' .\SmartAttendance.iss
;
; The staged tree comes from prepare.ps1: app\ is the one-file backend exe,
; its .env and the built front end, and vendor\ is the ZKFinger SDK installer.
; Nothing here reads your keys; the files are only copied.

#define MyAppName "Smart Attendance"
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#define MyAppPublisher "Smart Attendance System"
#define MyAppURL "http://localhost:8766"
#define Staged "build"

; The setup is no longer encrypted (removed 2026-10-18 at the user's request).
; Anyone holding SmartAttendance-...-Setup.exe can now extract the Supabase
; service-role key from the packaged .env, and the Brevo key is already inside
; the exe. Keep copies of the Setup file to the machines that need it.

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
UninstallDisplayIcon={app}\SmartAttendance.exe
UninstallDisplayName={#MyAppName}
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"
Name: "startup"; Description: "Start the scanner service when this user signs in"; GroupDescription: "Startup:"; Flags: unchecked
Name: "sdk"; Description: "Install the ZKFinger SDK driver (needed for the fingerprint scanner)"; GroupDescription: "Components:"

[Files]
Source: "{#Staged}\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; The SDK installer is staged but only executed if the "sdk" task is ticked.
Source: "{#Staged}\vendor\ZKFingerSDK_setup.exe"; DestDir: "{app}\vendor"; Flags: ignoreversion
; schema.sql is the one file an admin may want to re-run in Supabase Studio
; without opening an archive, so it is also dropped next to the shortcuts.
Source: "{#Staged}\app\schema.sql"; DestDir: "{group}"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\SmartAttendance.exe"; Parameters: "--open"; WorkingDir: "{app}"; Comment: "Runs the scanner service and opens the app"
Name: "{group}\Open the app"; Filename: "{#MyAppURL}"; Comment: "Only works while the service is running"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\SmartAttendance.exe"; Parameters: "--open"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\SmartAttendance"; Filename: "{app}\SmartAttendance.exe"; WorkingDir: "{app}"; Tasks: startup
; The plan's auto-start: a shortcut dropped into the Startup folder, so the
; console-less exe launches silently in the background every time this user
; signs in. One mechanism only — adding a Run key too would start two
; services that then fight over the same scanner.

[Run]
; The vendor SDK installs its own driver; it is itself an Inno Setup package,
; so /VERYSILENT is its normal silent switch. Skipped when the driver is
; already on the machine.
Filename: "{app}\vendor\ZKFingerSDK_setup.exe"; Parameters: "/VERYSILENT /NORESTART"; StatusMsg: "Installing the ZKFinger SDK driver…"; Tasks: sdk; Check: not SdkInstalled; Flags: waituntilterminated
Filename: "{app}\SmartAttendance.exe"; Parameters: "--open"; WorkingDir: "{app}"; Description: "Start {#MyAppName} now"; Flags: postinstall nowait skipifsilent

[Code]
// True when the vendor driver already sits on this machine, so the SDK setup
// above is skipped instead of re-running over it.
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
    'The ZKFinger SDK driver is still not on this computer (the "sdk" task was' + #13#10 +
    ' unticked, or its silent install did not take).' + #13#10 + #13#10 +
    'Run "' + ExpandConstant('{app}\vendor\ZKFingerSDK_setup.exe') + '" by hand,' +
    ' then restart the computer before plugging in the Live20R.',
    mbInformation, MB_OK);
end;
