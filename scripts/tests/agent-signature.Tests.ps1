#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# M16-T01 / ADR-044: a signature made by Node (the hub) verifies in Windows PowerShell 5.1 with
# built-in .NET only, over the exact body bytes, and the key id matches Node's RFC 7638 thumbprint.

BeforeAll {
  . (Join-Path $PSScriptRoot '..\agent\uniwake-agent.ps1')
  $path = Join-Path $PSScriptRoot '..\..\packages\shared\fixtures\agent\signature.json'
  $script:Fx = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
  $script:Body = [Convert]::FromBase64String($script:Fx.bodyBase64)
}

Describe 'Hub signature verification (ADR-044)' {
  It 'verifies the hub signature over the nonce and the exact body bytes' {
    Test-UwSignature -Body $script:Body -Nonce $script:Fx.nonce -Signature $script:Fx.signature `
      -N $script:Fx.key.n -E $script:Fx.key.e | Should -BeTrue
  }

  It 'rejects a changed body' {
    $tampered = [Convert]::FromBase64String($script:Fx.tamperedBodyBase64)
    Test-UwSignature -Body $tampered -Nonce $script:Fx.nonce -Signature $script:Fx.signature `
      -N $script:Fx.key.n -E $script:Fx.key.e | Should -BeFalse
  }

  It 'rejects a replayed answer (another nonce)' {
    Test-UwSignature -Body $script:Body -Nonce 'outro-nonce' -Signature $script:Fx.signature `
      -N $script:Fx.key.n -E $script:Fx.key.e | Should -BeFalse
  }

  It 'returns false for a malformed signature or key instead of throwing' {
    Test-UwSignature -Body $script:Body -Nonce $script:Fx.nonce -Signature 'nao-e-base64!' `
      -N $script:Fx.key.n -E $script:Fx.key.e | Should -BeFalse
    Test-UwSignature -Body $script:Body -Nonce $script:Fx.nonce -Signature $script:Fx.signature `
      -N 'AQAB' -E 'AQAB' | Should -BeFalse
  }

  It 'computes the same key id as the hub (RFC 7638 thumbprint)' {
    Get-UwKeyId -N $script:Fx.key.n -E $script:Fx.key.e | Should -BeExactly $script:Fx.keyId
  }

  It 'round-trips base64url' {
    $bytes = [byte[]](0, 251, 255, 62, 63)
    $text = ConvertTo-UwBase64Url -Bytes $bytes
    $text | Should -BeExactly 'APv_Pj8'
    $back = ConvertFrom-UwBase64Url -Text $text
    $back.GetType().Name | Should -Be 'Byte[]'
    ($back -join ',') | Should -Be ($bytes -join ',')
  }
}
