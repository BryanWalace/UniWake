<#
.SYNOPSIS
  CI only (M8-T12, FR-001.3): end-to-end update on a disposable Windows runner. Installs a test
  build that looks for updates on a loopback fake release server, updates it through the API to a
  newer version, then offers a broken version that must be rolled back.
.DESCRIPTION
  All three installers are built with -TestUpdateApi http://127.0.0.1:47199 (ADR-025); the broken
  one with -Break. Creates a Windows service: never run on a real computer.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BaseSetup,
  [Parameter(Mandatory = $true)][string]$NextSetup,
  [Parameter(Mandatory = $true)][string]$BrokenSetup,
  [string]$BaseVersion = '0.0.3',
  [string]$NextVersion = '0.0.4',
  [string]$BrokenVersion = '0.0.5'
)
$ErrorActionPreference = 'Stop'
# Any error, even outside the main try block, is reported as a public annotation.
trap {
  Write-Host "::error title=$($MyInvocation.MyCommand.Name)::$($_.Exception.Message -replace '\r?\n', ' | ') (line $($_.InvocationInfo.ScriptLineNumber))"
  break
}
if ($env:CI -ne 'true') { throw 'update-e2e.ps1 só roda no CI (instala um serviço de verdade).' }

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$base = 'http://127.0.0.1:47100'
$logs = Join-Path $env:RUNNER_TEMP 'uniwake-update'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
# Throwaway admin of the throwaway runner install.
$ciPassword = 'teste-do-instalador'

# Steps are notices too, so a failure shows how far the run got.
function Write-Step([string]$Message) { Write-Host "::notice title=passo::$Message" }
function Confirm-Condition([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "FALHOU: $Message" }
  Write-Host "   ok: $Message"
}

function Invoke-Api([string]$Method, [string]$Path, $Body = @{}) {
  $params = @{
    Method = $Method; Uri = "$base$Path"; WebSession = $session; UseBasicParsing = $true
    Headers = @{ Origin = $base }; ContentType = 'application/json'
  }
  if ($Method -ne 'GET') { $params.Body = ($Body | ConvertTo-Json -Compress) }
  return Invoke-RestMethod @params
}

function Connect-Hub([int]$Seconds) {
  $until = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $until) {
    try {
      Invoke-Api 'POST' '/api/auth/login' @{ username = 'admin'; password = $ciPassword } | Out-Null
      return
    } catch {
      Start-Sleep -Seconds 3
    }
  }
  throw "FALHOU: o painel não voltou em $Seconds s"
}

function Open-FakeRelease([string]$Version, [string]$Setup) {
  $out = Join-Path $logs "fake-$Version.log"
  return Start-Process -FilePath 'node' -PassThru -NoNewWindow -RedirectStandardOutput $out -ArgumentList @(
    (Join-Path $root 'scripts\ci\fake-release-server.ts'), '--port', '47199', '--version', $Version, '--installer', (Resolve-Path $Setup).Path
  )
}

function Wait-Version([string]$Version, [int]$Seconds) {
  $until = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $until) {
    try {
      $s = Invoke-Api 'GET' '/api/update'
      if ($s.current -eq $Version -and -not $s.installing) { return $s }
    } catch {
      # The service is down while it updates or rolls back: log in again once it answers.
      try { Invoke-Api 'POST' '/api/auth/login' @{ username = 'admin'; password = $ciPassword } | Out-Null } catch { Write-Verbose 'painel ainda fora do ar' }
    }
    Start-Sleep -Seconds 5
  }
  Get-ChildItem (Join-Path $env:ProgramData 'UniWake\logs') -Recurse -File -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host "--- $($_.FullName)"; Get-Content $_.FullName -Tail 60 | Write-Host }
  throw "FALHOU: a versão $Version não ficou em execução em $Seconds s"
}

function Get-DashboardNotice {
  return @((Invoke-Api 'GET' '/api/dashboard').notices)
}

. (Join-Path $PSScriptRoot 'Report-Failure.ps1')
try {
  Write-Step "Instalando $BaseVersion (procura atualizações no servidor falso)"
  $p = Start-Process -FilePath $BaseSetup -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=$(Join-Path $logs 'install.log')") -Wait -PassThru
  Confirm-Condition ($p.ExitCode -eq 0) 'instalação'
  $until = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $until) {
    try { if ((Invoke-WebRequest "$base/api/health" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) { break } } catch { Start-Sleep -Seconds 2 }
  }
  Invoke-Api 'POST' '/api/auth/setup' @{ username = 'admin'; password = $ciPassword } | Out-Null
  Connect-Hub 30

  Write-Step "Atualização para $NextVersion pelo painel"
  $fake = Open-FakeRelease $NextVersion $NextSetup
  try {
    Start-Sleep -Seconds 2
    $s = Invoke-Api 'POST' '/api/update/check'
    Confirm-Condition ($s.available -and $s.latest.version -eq $NextVersion) "versão $NextVersion oferecida"
    Confirm-Condition $s.canInstall 'este UniWake pode instalar'
    Invoke-Api 'POST' '/api/update/install' @{ override = $true } | Out-Null
    Wait-Version $NextVersion 600 | Out-Null
    Confirm-Condition $true "versão $NextVersion em execução"
    $until = (Get-Date).AddSeconds(90)
    do {
      $done = Get-DashboardNotice | Where-Object { $_.type -eq 'update_done' }
      if ($null -eq $done) { Start-Sleep -Seconds 5 }
    } while ($null -eq $done -and (Get-Date) -lt $until)
    Confirm-Condition ($null -ne $done) 'aviso de atualização concluída no painel'
  } finally {
    Stop-Process -Id $fake.Id -Force -ErrorAction SilentlyContinue
  }

  Write-Step "Versão quebrada ${BrokenVersion}: deve voltar para $NextVersion"
  $fake = Open-FakeRelease $BrokenVersion $BrokenSetup
  try {
    Start-Sleep -Seconds 2
    $s = Invoke-Api 'POST' '/api/update/check'
    Confirm-Condition ($s.available -and $s.latest.version -eq $BrokenVersion) "versão $BrokenVersion oferecida"
    Invoke-Api 'POST' '/api/update/install' @{ override = $true } | Out-Null
    # stop + install + 120 s of failed health + rollback
    Start-Sleep -Seconds 60
    Wait-Version $NextVersion 900 | Out-Null
    $until = (Get-Date).AddSeconds(90)
  do {
    $failed = Get-DashboardNotice | Where-Object { $_.type -eq 'update_failed' }
    if ($null -eq $failed) { Start-Sleep -Seconds 5 }
  } while ($null -eq $failed -and (Get-Date) -lt $until)
    Confirm-Condition ($null -ne $failed -and $failed.data.message -like 'Atualização revertida*') 'aviso "Atualização revertida" no painel'
  } finally {
    Stop-Process -Id $fake.Id -Force -ErrorAction SilentlyContinue
  }
  Write-Step 'Atualização de ponta a ponta: tudo certo'
} catch {
  Write-CiError $_
  Save-CiLog @($logs, (Join-Path $env:ProgramData 'UniWake\logs'), (Join-Path $env:ProgramData 'UniWake\updates'))
  throw
}
