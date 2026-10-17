# Safety net and fakes for the uniwake-agent.ps1 tests (constitution §5: no real shutdown, task,
# power plan or network from a test). Call Register-UwFakeAgent in every BeforeEach: every system
# wrapper of the agent is mocked; the ones that change the computer throw unless a test overrides
# them. The wrappers themselves also refuse to run outside Invoke-UwAgent (Assert-UwRealSystem).
# The "every system wrapper is faked" test keeps this list complete.

$script:UwAgentSystemFunctions = @(
  'Get-UwUtcNow', 'Wait-UwSecond', 'Get-UwBootTime', 'Invoke-UwHttp', 'Get-UwSessionInfo',
  'Get-UwFreezeInfo', 'Get-UwPowerInfo', 'Invoke-UwShutdown', 'Register-UwWakeTask',
  'Start-UwWarningTask', 'Test-UwAgentFolder', 'Register-UwRepairTask', 'Get-UwAntivirusRaw',
  'Get-UwHibernateInfo', 'Get-UwSleepKind'
)

# Fake clock (UTC ms) shared by the mocks; Wait-UwSecond advances it instantly.
$script:UwFake = @{ Now = 0L; Shutdowns = @(); WakeTriggers = $null; WarningStarted = 0 }

function Register-UwFakeAgent {
  param([string]$Root)
  $refuse = { throw "Teste chamou uma função real que altera o computador: $($MyInvocation.MyCommand.Name)" }
  $script:UwFake.Shutdowns = New-Object System.Collections.ArrayList
  $script:UwFake.WakeTriggers = $null
  $script:UwFake.WarningStarted = 0
  Mock Get-UwUtcNow { $script:UwFake.Now }
  Mock Wait-UwSecond { $script:UwFake.Now += [long]$Seconds * 1000 }
  Mock Get-UwBootTime { $null }
  Mock Get-UwSessionInfo { @{ loggedOn = $false; sessions = 0 } }
  Mock Get-UwFreezeInfo { @{ product = $null; state = 'none'; persistent = $false } }
  Mock Get-UwPowerInfo { @{ sleepAfterMinutes = 30; wakeTimers = 'enabled' } }
  Mock Test-UwAgentFolder { $true }
  Mock Invoke-UwHttp { throw 'sem rede no teste' }
  Mock Invoke-UwShutdown { [void]$script:UwFake.Shutdowns.Add(@($Arguments)); 0 }
  Mock Register-UwWakeTask { $script:UwFake.WakeTriggers = @($AtMs) }
  Mock Start-UwWarningTask { $script:UwFake.WarningStarted++ }
  $script:UwFake.RepairTask = $null
  Mock Register-UwRepairTask { $script:UwFake.RepairTask = $Command }
  Mock Get-UwAntivirusRaw { @{ products = @(); detections = @() } }
  Mock Get-UwHibernateInfo { @{ enabled = $false; afterMinutes = 0 } }
  Mock Get-UwSleepKind { 'unknown' }
  if ($Root) {
    $script:UwAgentDir = Join-Path $Root 'agent'
    $script:UwDataDir = Join-Path $Root 'agent\data'
    $script:UwUiDir = Join-Path $Root 'ui'
    New-Item -ItemType Directory -Force -Path $script:UwDataDir, (Join-Path $script:UwUiDir 'request'), (Join-Path $script:UwUiDir 'response') | Out-Null
  }
  [void]$refuse
}

# A hub key pair made by .NET (the real hub uses Node; M16-T01 proved both agree).
function New-UwTestHub {
  param([string]$Url = 'http://10.0.0.5:47101', [string]$InstanceId = '0e1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b')
  $rsa = New-Object System.Security.Cryptography.RSACng 2048
  $p = $rsa.ExportParameters($false)
  $n = ConvertTo-UwBase64Url -Bytes $p.Modulus
  $e = ConvertTo-UwBase64Url -Bytes $p.Exponent
  [pscustomobject]@{
    Rsa = $rsa; Url = $Url; KeyId = (Get-UwKeyId -N $n -E $e)
    Entry = [pscustomobject]@{
      instanceId = $InstanceId; urls = @($Url); keyId = (Get-UwKeyId -N $n -E $e)
      publicKey = [pscustomobject]@{ n = $n; e = $e }
    }
  }
}

# A signed HTTP answer as Invoke-UwHttp returns it.
function New-UwSignedResponse {
  param($Hub, [string]$Nonce, $Answer, [int]$Status = 200)
  $body = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Answer -Depth 10 -Compress))
  $prefix = [System.Text.Encoding]::UTF8.GetBytes("uniwake-agent-v1`n$Nonce`n")
  $data = New-Object byte[] ($prefix.Length + $body.Length)
  [Array]::Copy($prefix, 0, $data, 0, $prefix.Length)
  [Array]::Copy($body, 0, $data, $prefix.Length, $body.Length)
  $sig = [Convert]::ToBase64String($Hub.Rsa.SignData($data,
      [System.Security.Cryptography.HashAlgorithmName]::SHA256,
      [System.Security.Cryptography.RSASignaturePadding]::Pkcs1))
  @{ Status = $Status; Body = $body; Headers = @{ 'x-uniwake-key' = $Hub.KeyId; 'x-uniwake-signature' = $sig } }
}

# The shared contract fixture (packages/shared/fixtures/agent), the same file Vitest checks.
function Get-UwFixture {
  param([string]$Name)
  $path = Join-Path $PSScriptRoot "..\..\packages\shared\fixtures\agent\$Name"
  Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
}

# Writes the files the preparation leaves: config (hub list), token.
function Install-UwTestAgent {
  param($Hub, [string]$Token = 'tok-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  Save-UwJson (Join-Path $script:UwAgentDir 'config.json') ([ordered]@{
      protocol = 1; epoch = 0; persistentPath = $null; hubs = @($Hub.Entry)
    })
  [System.IO.File]::WriteAllText((Join-Path $script:UwAgentDir 'token.txt'), $Token)
}
