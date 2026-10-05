#Requires -Version 5.1
<#
  UniWake panel certificate (ADR-012, ADR-026).
  Creates a self-signed certificate for the LAN address and this computer's name, exports it
  as a password-protected PFX and removes it from the certificate store. The password is read
  from stdin (never from the command line). Writes nothing else.
#>
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')][string]$Address,
    [Parameter(Mandatory = $true)][string]$OutFile
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$password = [Console]::In.ReadLine()
if ([string]::IsNullOrEmpty($password)) { throw 'missing password on stdin' }
$secure = ConvertTo-SecureString -String $password -AsPlainText -Force
$name = [System.Net.Dns]::GetHostName()
$cert = New-SelfSignedCertificate `
    -Subject "CN=UniWake ($name)" `
    -TextExtension @("2.5.29.17={text}IPAddress=$Address&DNS=$name") `
    -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 `
    -NotAfter (Get-Date).AddYears(5) `
    -CertStoreLocation 'Cert:\CurrentUser\My'
try {
    Export-PfxCertificate -Cert $cert -FilePath $OutFile -Password $secure | Out-Null
} finally {
    Remove-Item -Path ('Cert:\CurrentUser\My\' + $cert.Thumbprint) -DeleteKey -ErrorAction SilentlyContinue
}
Write-Output 'ok'
