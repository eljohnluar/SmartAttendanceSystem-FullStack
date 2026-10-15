# One command to produce the installer:
#
#   cd C:\Projects\smartattendancesystem\installer
#   powershell -ExecutionPolicy Bypass -File .\build.ps1
#
# It stages the runtime and the app (prepare.ps1), then compiles the setup with
# Inno Setup. You are asked for a password twice; that is the password whoever
# installs this has to type, and it is what keeps the .env inside the setup
# unreadable to anyone else.

param(
  [switch]$SkipPrepare,
  [string]$Version
)

$ErrorActionPreference = 'Stop'

function Unprotect($secure) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

if (-not $env:SETUP_PASSWORD) {
  Write-Host 'Choose the password for this installer. It is required on every device you install it on.' -ForegroundColor Yellow
  $first = Read-Host 'Installer password' -AsSecureString
  $second = Read-Host 'Repeat it' -AsSecureString
  if ((Unprotect $first) -ne (Unprotect $second)) { throw 'The two passwords did not match.' }
  if ((Unprotect $first).Length -lt 8) { throw 'Use at least 8 characters.' }
  $env:SETUP_PASSWORD = Unprotect $first

  # Saved so the Inno Setup Compiler window can build on its own afterwards.
  # password.ini is git-ignored; delete it when you are done if you prefer.
  @(
    '; written by build.ps1 - the Inno Setup Compiler window reads this',
    '',
    '[setup]',
    "password=$($env:SETUP_PASSWORD)"
  ) | Set-Content (Join-Path $PSScriptRoot 'password.ini') -Encoding ascii
}

if (-not $SkipPrepare) {
  & (Join-Path $PSScriptRoot 'prepare.ps1')
}

$iscc = @(
  "$env:ProgramFiles\Inno Setup 7\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 7\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $iscc) {
  throw 'Inno Setup was not found. Install it from jrsoftware.org, or run the compiler manually.'
}

Write-Host ">> Compiling with $iscc" -ForegroundColor Cyan
$iss = Join-Path $PSScriptRoot 'SmartAttendance.iss'
$arguments = @($iss)
if ($Version) { $arguments += "/DMyAppVersion=$Version" }

& $iscc @arguments
if ($LASTEXITCODE -ne 0) { throw "Inno Setup reported errors (code $LASTEXITCODE)." }

$produced = Get-ChildItem (Join-Path $PSScriptRoot 'Output') -Filter '*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($produced) {
  $sizeMb = [math]::Round($produced.Length / 1MB, 1)
  Write-Host ''
  Write-Host ">> Ready: $($produced.FullName)  ($sizeMb MB)" -ForegroundColor Green
  Write-Host '   Copy this one file to the other device on a USB stick.'
}
