# Builds everything the installer ships, from this machine's source.
#
#   cd C:\Projects\smartattendancesystem\installer
#   powershell -ExecutionPolicy Bypass -File .\prepare.ps1
#
# It never prints your keys. The exe itself now carries the Brevo key baked
# in (see backend\main.py), and backend\.env is copied into the staging folder
# as an opaque file for the Supabase mirror. The build\ folder is git-ignored
# because it holds both.

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root 'backend'
$Build = Join-Path $PSScriptRoot 'build'
$App = Join-Path $Build 'app'
$Vendor = Join-Path $Build 'vendor'

$VenvPython = Join-Path $Backend '.venv\Scripts\python.exe'
$SystemPython = 'python'
$PipPython = if (Test-Path $VenvPython) { $VenvPython } else { $SystemPython }

$SdkSource = Get-ChildItem $Root -Directory -Filter 'ZKFinger*' |
  ForEach-Object { Join-Path $_.FullName 'setup.exe' } |
  Where-Object { Test-Path $_ } | Select-Object -First 1

function Step($message) { Write-Host ">> $message" -ForegroundColor Cyan }

Step 'Checking what this build needs'
foreach ($part in @('backend\main.py', 'backend\.env', 'frontend\dist\index.html')) {
  $path = Join-Path $Root $part
  if (-not (Test-Path $path)) {
    if ($part -eq 'frontend\dist\index.html') {
      throw "frontend\dist is missing. Build it first:  cd ..\frontend ; npm run build"
    }
    if ($part -eq 'backend\.env') {
      throw "backend\.env is missing. The installer needs it to carry the Supabase mirror settings."
    }
    throw "Missing $part"
  }
}
if (-not $SdkSource) {
  throw 'ZKFinger SDK setup.exe not found. The folder "ZKFinger Standard SDK 5.3.0.33" must sit next to the installer folder.'
}

Step 'Making sure PyInstaller is available'
& $PipPython -m PyInstaller --version *> $null
if ($LASTEXITCODE -ne 0) {
  & $PipPython -m pip install --quiet pyinstaller
  if ($LASTEXITCODE -ne 0) { throw 'Could not install pyinstaller into the backend venv.' }
}

Step 'Building the one-file exe (backend\dist\SmartAttendance.exe)'
Push-Location $Backend
try {
  & $PipPython -m PyInstaller --noconfirm --clean --noconsole --onefile --name SmartAttendance main.py
  if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed with code $LASTEXITCODE." }
} finally { Pop-Location }

Step 'Staging the app'
if (Test-Path $Build) { Remove-Item $Build -Recurse -Force }
New-Item -ItemType Directory -Force -Path $App | Out-Null
New-Item -ItemType Directory -Force -Path $Vendor | Out-Null
Copy-Item (Join-Path $Backend 'dist\SmartAttendance.exe') $App -Force

Step 'Staging the web app'
# The destination must exist first: Copy-Item of a wildcard onto a missing
# directory flattens the tree and drops the assets\ folder, which leaves the
# served index.html pointing at files that are not there.
$StageWeb = Join-Path $App 'web'
New-Item -ItemType Directory -Force -Path $StageWeb | Out-Null
Copy-Item (Join-Path $Root 'frontend\dist\*') $StageWeb -Recurse -Force
if (-not (Test-Path (Join-Path $StageWeb 'assets'))) {
  throw 'Staged web folder is missing assets\; the copy flattened. Delete installer\build and rerun.'
}

Step 'Staging schema.sql and the SDK driver'
Copy-Item (Join-Path $Backend 'schema.sql') $App -Force
Copy-Item (Join-Path $Backend '.env.example') $App -Force
Copy-Item $SdkSource (Join-Path $Vendor 'ZKFingerSDK_setup.exe') -Force

Step 'Copying backend\.env next to the exe (contents not shown)'
Copy-Item (Join-Path $Backend '.env') (Join-Path $App '.env') -Force
$EnvSize = (Get-Item (Join-Path $App '.env')).Length
Write-Host "   .env carried over: $EnvSize bytes"

Step 'Done'
Write-Host "Staged in $Build"
Write-Host "Next: compile SmartAttendance.iss with Inno Setup (or run build.ps1)."
