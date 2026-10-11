<#
.SYNOPSIS
  UniWake agent for lab PCs (v1.3, ADR-042). Run by the scheduled task "UniWake" as SYSTEM.
.DESCRIPTION
  Pulls orders and the shutdown agenda from the hub and runs them, also while the hub is off.
  Built-in Windows components only (PowerShell 5.1, .NET Framework, Task Scheduler, shutdown.exe).
  Nothing the hub sends is used unless its signature verifies (ADR-044).
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------------ signatures (ADR-044)

$script:UwSignedPrefix = 'uniwake-agent-v1'

function ConvertFrom-UwBase64Url {
  [CmdletBinding()]
  [OutputType([byte[]])]
  param([Parameter(Mandatory)][string]$Text)
  $b64 = $Text.Replace('-', '+').Replace('_', '/')
  switch ($b64.Length % 4) {
    2 { $b64 += '==' }
    3 { $b64 += '=' }
  }
  , [Convert]::FromBase64String($b64)
}

function ConvertTo-UwBase64Url {
  [CmdletBinding()]
  [OutputType([string])]
  param([Parameter(Mandatory)][byte[]]$Bytes)
  [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

# RFC 7638 thumbprint of the hub's RSA public key: the id pinned by -HubKeyId.
function Get-UwKeyId {
  [CmdletBinding()]
  [OutputType([string])]
  param(
    [Parameter(Mandatory)][string]$N,
    [Parameter(Mandatory)][string]$E
  )
  $json = '{"e":"' + $E + '","kty":"RSA","n":"' + $N + '"}'
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    ConvertTo-UwBase64Url -Bytes $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($json))
  } finally {
    $sha.Dispose()
  }
}

# True only if $Signature is the hub's RSASSA-PKCS1-v1_5/SHA-256 signature over
# "uniwake-agent-v1\n<nonce>\n" followed by the exact body bytes.
function Test-UwSignature {
  [CmdletBinding()]
  [OutputType([bool])]
  param(
    [Parameter(Mandatory)][byte[]]$Body,
    [Parameter(Mandatory)][string]$Nonce,
    [Parameter(Mandatory)][string]$Signature,
    [Parameter(Mandatory)][string]$N,
    [Parameter(Mandatory)][string]$E
  )
  try {
    $prefix = [System.Text.Encoding]::UTF8.GetBytes("$script:UwSignedPrefix`n$Nonce`n")
    $data = New-Object byte[] ($prefix.Length + $Body.Length)
    [Array]::Copy($prefix, 0, $data, 0, $prefix.Length)
    [Array]::Copy($Body, 0, $data, $prefix.Length, $Body.Length)
    $params = New-Object System.Security.Cryptography.RSAParameters
    $params.Modulus = ConvertFrom-UwBase64Url -Text $N
    $params.Exponent = ConvertFrom-UwBase64Url -Text $E
    $rsa = New-Object System.Security.Cryptography.RSACng
    try {
      $rsa.ImportParameters($params)
      return $rsa.VerifyData(
        $data,
        [Convert]::FromBase64String($Signature),
        [System.Security.Cryptography.HashAlgorithmName]::SHA256,
        [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    } finally {
      $rsa.Dispose()
    }
  } catch {
    # A malformed key or signature is a failed verification, never an exception for the caller.
    return $false
  }
}
