#Requires -Version 5.1
<#
.SYNOPSIS
  Builds the Dynamic Island app as a signed MSIX package (with package identity),
  using makeappx/signtool sourced from the Microsoft.Windows.SDK.BuildTools NuGet
  package — so NO full Windows SDK install is required.

  The MSIX grants package identity, which is REQUIRED by the Windows
  UserNotificationListener API (it does not work from an unpackaged exe).

  Usage (run from repo root):
    # first time only (admin): make + trust the dev cert
    powershell -ExecutionPolicy Bypass -File src-tauri\packaging\build-msix.ps1 -MakeCert
    # build + pack + sign (+ install)
    powershell -ExecutionPolicy Bypass -File src-tauri\packaging\build-msix.ps1 -Install
#>

[CmdletBinding()]
param(
  [switch]$MakeCert,   # generate + trust the self-signed dev cert (admin, once)
  [switch]$Install,    # Add-AppxPackage after building
  [string]$Publisher = "CN=Dynamic Island Dev",
  [string]$PfxPath = "$PSScriptRoot\DynamicIslandDev.pfx",
  [string]$PfxPassword = "dynamic-island-dev"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tauriDir = Join-Path $repoRoot "src-tauri"
$staging = Join-Path $PSScriptRoot "staging"
$outDir = Join-Path $PSScriptRoot "build"
$msixPath = Join-Path $outDir "DynamicIsland.msix"

# --- locate makeappx/signtool: prefer NuGet-extracted, fall back to system SDK
$toolsDir = Join-Path $repoRoot "src-tauri\packaging\sdktools"
$candidateRoots = @(
  $toolsDir,
  "C:\Program Files (x86)\Windows Kits\10\bin",
  "C:\Program Files\Windows Kits\10\bin"
)
function Find-Tool($name) {
  foreach ($root in $candidateRoots) {
    if (Test-Path $root) {
      $hit = Get-ChildItem -Path $root -Recurse -Filter $name -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
      if ($hit) { return $hit.FullName }
    }
  }
  return $null
}
$makeAppx = Find-Tool "makeappx.exe"
$signTool = Find-Tool "signtool.exe"
if (-not $makeAppx -or -not $signTool) {
  Write-Error "makeappx.exe/signtool.exe not found. Download Microsoft.Windows.SDK.BuildTools NuGet and extract to $toolsDir."
  exit 1
}
Write-Host "MakeAppx: $makeAppx" -ForegroundColor DarkGray
Write-Host "SignTool: $signTool" -ForegroundColor DarkGray

# --- 0. make + trust dev cert (once, admin) ---------------------------------
if ($MakeCert) {
  Write-Host "`n[cert] Creating self-signed code-signing certificate..." -ForegroundColor Cyan
  $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Publisher `
    -KeyUsage DigitalSignature -FriendlyName "Dynamic Island Dev" `
    -CertStoreLocation "Cert:\CurrentUser\My" -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears(3)
  Export-PfxCertificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" `
    -FilePath $PfxPath -Password (ConvertTo-SecureString $PfxPassword -AsPlainText -Force) | Out-Null
  $cer = "$env:TEMP\di_pub.cer"
  Export-Certificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" -FilePath $cer -Force | Out-Null
  Import-Certificate -FilePath $cer -CertStoreLocation "Cert:\LocalMachine\Root" | Out-Null
  Import-Certificate -FilePath $cer -CertStoreLocation "Cert:\LocalMachine\TrustedPeople" | Out-Null
  Remove-Item $cer -Force
  Write-Host "  cert + PFX ready, trusted on this machine." -ForegroundColor Green
  return
}

# --- 1. confirm release exe exists -----------------------------------------
$exe = Join-Path $tauriDir "target\release\dynamic-island.exe"
if (-not (Test-Path $exe)) {
  Write-Host "`n[build] Building release exe..." -ForegroundColor Cyan
  Push-Location $repoRoot
  & pnpm tauri build --no-bundle 2>&1 | Write-Host
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
  Pop-Location
}

# --- 2. stage ---------------------------------------------------------------
Write-Host "`n[stage] Staging MSIX contents..." -ForegroundColor Cyan
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null
Copy-Item $exe $staging
Copy-Item (Join-Path $PSScriptRoot "AppxManifest.xml") $staging
$iconsDest = Join-Path $staging "icons"
New-Item -ItemType Directory -Path $iconsDest | Out-Null
Get-ChildItem (Join-Path $tauriDir "icons") -Filter "*.png" | Copy-Item -Destination $iconsDest

# --- 3. pack ----------------------------------------------------------------
Write-Host "`n[pack] Packing MSIX..." -ForegroundColor Cyan
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Path $outDir | Out-Null
& $makeAppx pack /d $staging /p $msixPath /nv 2>&1 | Write-Host
if ($LASTEXITCODE -ne 0) { throw "MakeAppx pack failed" }

# --- 4. sign ----------------------------------------------------------------
Write-Host "`n[sign] Signing MSIX..." -ForegroundColor Cyan
if (-not (Test-Path $PfxPath)) {
  Write-Warning "PFX not found at $PfxPath. Run with -MakeCert first (as admin)."
  throw "missing cert"
}
& $signTool sign /fd SHA256 /f $PfxPath /p $PfxPassword $msixPath 2>&1 | Write-Host
if ($LASTEXITCODE -ne 0) { throw "SignTool failed" }
Write-Host "`n  Done: $msixPath" -ForegroundColor Green

# --- 5. install -------------------------------------------------------------
if ($Install) {
  Write-Host "`n[install] Installing MSIX..." -ForegroundColor Cyan
  Add-AppxPackage -Path $msixPath
  Write-Host "  Installed. Launch from Start menu." -ForegroundColor Green
}
