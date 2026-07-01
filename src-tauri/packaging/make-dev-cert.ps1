#Requires -Version 5.1
<#
.SYNOPSIS
  Creates a self-signed code-signing certificate for signing the MSIX package
  and installs it into the Trusted Root / Trusted People stores so the package
  is trusted on this machine.

.DESCRIPTION
  Run once (as Administrator) before build-msix.ps1. The Publisher in
  AppxManifest.xml MUST match the -Subject here (CN=Dynamic Island Dev).

  Usage (in an elevated PowerShell):
    powershell -ExecutionPolicy Bypass -File src-tauri\packaging\make-dev-cert.ps1
#>

[CmdletBinding()]
param(
  [string]$Subject = "CN=Dynamic Island Dev",
  [string]$PfxPath = "$PSScriptRoot\DynamicIslandDev.pfx",
  [securestring]$Password = (ConvertTo-SecureString -String "dynamic-island-dev" -Force -AsPlainText)
)

$ErrorActionPreference = "Stop"

Write-Host "Creating self-signed code-signing certificate: $Subject" -ForegroundColor Cyan

# Create the cert in the current user's personal store.
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $Subject `
  -KeyUsage DigitalSignature `
  -FriendlyName "Dynamic Island Dev Signing" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -HashAlgorithm SHA256 `
  -NotAfter (Get-Date).AddYears(3)

if (-not $cert) { throw "Failed to create certificate." }

# Export to a PFX (with private key) so SignTool can use it.
$exportPath = "Cert:\CurrentUser\My\$($cert.Thumbprint)"
Export-PfxCertificate -Cert $exportPath -FilePath $PfxPath -Password $Password | Out-Null
Write-Host "  Exported PFX -> $PfxPath" -ForegroundColor Green

# Trust it: copy into LocalMachine\Root and TrustedPeople (requires admin).
$source = "Cert:\CurrentUser\My\$($cert.Thumbprint)"
Import-Certificate -CertPath (Export-Certificate -Cert $source -FilePath "$env:TEMP\di_pub.cer" -Force).FullName `
  -CertStoreLocation "Cert:\LocalMachine\Root" | Out-Null
Import-Certificate -CertPath "$env:TEMP\di_pub.cer" `
  -CertStoreLocation "Cert:\LocalMachine\TrustedPeople" | Out-Null
Remove-Item "$env:TEMP\di_pub.cer" -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done. Thumbprint: $($cert.Thumbprint)" -ForegroundColor Green
Write-Host "The MSIX signed with this cert will be trusted on THIS machine." -ForegroundColor Yellow
Write-Host "To distribute to others, use a real code-signing certificate." -ForegroundColor Yellow
