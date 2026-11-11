# One command to produce the installer:
#
#   cd C:\Projects\smartattendancesystem\installer
#   powershell -ExecutionPolicy Bypass -File .\build.ps1
#
# It stages the exe, the web app and the SDK driver (prepare.ps1), then compiles
# the setup with Inno Setup. The setup asks for no password.

param(
  [switch]$SkipPrepare,
  [string]$Version
)

$ErrorActionPreference = 'Stop'

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
