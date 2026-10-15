# Builds the folder the installer ships, from this machine's source.
#
#   cd C:\Projects\smartattendancesystem\installer
#   powershell -ExecutionPolicy Bypass -File .\prepare.ps1
#
# It never prints your keys. It copies backend\.env into the staging folder as
# an opaque file, and that folder is git-ignored because it now holds them.

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Vendor = Join-Path $PSScriptRoot 'vendor'
$Build = Join-Path $PSScriptRoot 'build'
$App = Join-Path $Build 'app'
$Runtime = Join-Path $Build 'runtime'

$PythonVersion = '3.14.3'
$PythonAbi = '314'
$EmbedUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$EmbedZip = Join-Path $Vendor "python-$PythonVersion-embed-amd64.zip"

$VenvPython = Join-Path $Root 'backend\.venv\Scripts\python.exe'
$SystemPython = 'python'
$PipPython = if (Test-Path $VenvPython) { $VenvPython } else { $SystemPython }

function Step($message) { Write-Host ">> $message" -ForegroundColor Cyan }

Step 'Checking what this build needs'
foreach ($part in @('backend\main.py', 'backend\webapp.py', 'backend\.env', 'frontend\dist\index.html')) {
  $path = Join-Path $Root $part
  if (-not (Test-Path $path)) {
    if ($part -eq 'frontend\dist\index.html') {
      throw "frontend\dist is missing. Build it first:  cd ..\frontend ; npm run build"
    }
    if ($part -eq 'backend\.env') {
      throw "backend\.env is missing. The installer needs it to carry your keys."
    }
    throw "Missing $part"
  }
}

$BackendFiles = @(
  'main.py', 'webapp.py', 'config.py', 'db.py', 'service.py', 'scanner.py', 'sync.py',
  'capture.py', 'notifier.py', 'staff_sync.py', 'zkfp.py', 'enroll.py', 'schema.sql', '.env.example'
)

Step 'Downloading the embeddable Python (cached in installer\vendor)'
New-Item -ItemType Directory -Force -Path $Vendor | Out-Null
if (-not (Test-Path $EmbedZip)) {
  Invoke-WebRequest -Uri $EmbedUrl -OutFile $EmbedZip
}

Step 'Unpacking the runtime'
if (Test-Path $Build) { Remove-Item $Build -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
# Expand-Archive, not tar: Git's tar mishandles Windows paths in .bat scripts.
$Unpacked = Join-Path $Vendor 'embed-unpacked'
if (Test-Path $Unpacked) { Remove-Item $Unpacked -Recurse -Force }
Expand-Archive -Path $EmbedZip -DestinationPath $Unpacked
Copy-Item (Join-Path $Unpacked '*') $Runtime -Recurse
Remove-Item $Unpacked -Recurse -Force

Step 'Enabling site-packages and the app in the embeddable build'
# A ._pth file puts Python in isolated mode: it ignores PYTHONPATH and the
# script's own folder, and searches only the entries listed here. So both the
# packages and the backend have to be named, relative to runtime\.
$Pth = Get-ChildItem $Runtime -Filter "*._pth" | Select-Object -First 1
$Lines = Get-Content $Pth.FullName | ForEach-Object {
  if ($_ -match '^\s*#?\s*import site') { 'import site' } else { $_ }
}
@($Lines) + @('Lib\site-packages', '..\app\backend') | Set-Content $Pth.FullName -Encoding ascii

Step 'Installing httpx and python-dotenv into the runtime'
& $PipPython -m pip install --quiet --no-warn-script-location --target (Join-Path $Runtime 'Lib\site-packages') `
  httpx==0.28.1 python-dotenv==1.2.1
if ($LASTEXITCODE -ne 0) { throw "pip install failed with code $LASTEXITCODE" }

Step 'Staging the backend'
$StageBackend = Join-Path $App 'backend'
New-Item -ItemType Directory -Force -Path $StageBackend | Out-Null
foreach ($file in $BackendFiles) {
  $source = Join-Path $Root "backend\$file"
  if (Test-Path $source) { Copy-Item $source $StageBackend -Force }
}

Step 'Staging the web app'
$StageWeb = Join-Path $App 'web'
New-Item -ItemType Directory -Force -Path $StageWeb | Out-Null
Copy-Item (Join-Path $Root 'frontend\dist\*') $StageWeb -Recurse -Force

Step 'Copying backend\.env into the package (contents not shown)'
Copy-Item (Join-Path $Root 'backend\.env') (Join-Path $StageBackend '.env') -Force
$EnvSize = (Get-Item (Join-Path $StageBackend '.env')).Length
Write-Host "   .env carried over: $EnvSize bytes"

Step 'Done'
Write-Host "Staged in $Build"
Write-Host "Next: compile SmartAttendance.iss with Inno Setup (or run build.ps1)."
