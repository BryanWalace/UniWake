<#
.SYNOPSIS
  CI only (FR-001.1, AC-001-01a/02/03): installs, upgrades and uninstalls UniWake on a disposable
  Windows runner. It creates a Windows service, firewall rules and data: never run it on a real
  computer.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$V1Setup,
  [Parameter(Mandatory = $true)][string]$V2Setup,
  [string]$V1 = '0.0.1',
  [string]$V2 = '0.0.2'
)
$ErrorActionPreference = 'Stop'
# Any error, even outside the main try block, is reported as a public annotation.
trap {
  Write-Host "::error title=$($MyInvocation.MyCommand.Name)::$($_.Exception.Message -replace '\r?\n', ' | ') (line $($_.InvocationInfo.ScriptLineNumber))"
  break
}
if ($env:CI -ne 'true') { throw 'installer-smoke.ps1 só roda no CI (instala um serviço de verdade).' }

$base = 'http://127.0.0.1:47100'
$appDir = Join-Path $env:ProgramFiles 'UniWake'
$dataDir = Join-Path $env:ProgramData 'UniWake'
$shortcut = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\UniWake.url'
$logs = Join-Path $env:RUNNER_TEMP 'uniwake-installer'
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

function Install-Setup([string]$Setup, [string]$Name) {
  $log = Join-Path $logs "$Name.log"
  $p = Start-Process -FilePath $Setup -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=$log") -Wait -PassThru
  if ($p.ExitCode -ne 0) {
    Get-Content $log -Tail 80 | Write-Host
    throw "FALHOU: $Name terminou com $($p.ExitCode)"
  }
}

function Wait-Health([int]$Seconds) {
  $until = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $until) {
    try {
      $r = Invoke-WebRequest -Uri "$base/api/health" -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { return }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  Get-ChildItem (Join-Path $dataDir 'logs') -Recurse -File -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host "--- $($_.FullName)"; Get-Content $_.FullName -Tail 40 | Write-Host }
  throw "FALHOU: GET /api/health não respondeu 200 em $Seconds s"
}

function Invoke-Api([string]$Method, [string]$Path, $Body = $null) {
  $params = @{
    Method = $Method; Uri = "$base$Path"; WebSession = $session; UseBasicParsing = $true
    Headers = @{ Origin = $base }; ContentType = 'application/json'
  }
  if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Compress) }
  return Invoke-RestMethod @params
}

function Test-FirewallRule([string]$Name) {
  & netsh advfirewall firewall show rule name="$Name" | Out-Null
  return $LASTEXITCODE -eq 0
}

# AC-205-01: one rule name for TCP and UDP 47102, Domain and Private profiles only (locale-proof).
function Test-TeamFirewallRule {
  $rules = @(Get-NetFirewallRule -DisplayName 'UniWake - Modo equipe' -ErrorAction SilentlyContinue)
  if ($rules.Count -ne 2) { return $false }
  $protocols = @()
  foreach ($r in $rules) {
    $port = $r | Get-NetFirewallPortFilter
    if ($port.LocalPort -ne '47102') { return $false }
    if ($r.Direction -ne 'Inbound' -or $r.Action -ne 'Allow') { return $false }
    if ([string]$r.Profile -ne 'Domain, Private') { return $false }
    $protocols += [string]$port.Protocol
  }
  return (($protocols | Sort-Object) -join ',') -eq 'TCP,UDP'
}

. (Join-Path $PSScriptRoot 'Report-Failure.ps1')
try {
  # ------------------------------------------------------------------ AC-001-01a
  Write-Step "Instalação silenciosa de $V1"
  Install-Setup $V1Setup 'install-v1'
  $svc = Get-Service -Name UniWake
  # "start" returns once the SCM accepted it (StartPending); give the service time to run.
  $until = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $until -and (Get-Service -Name UniWake).Status -ne 'Running') { Start-Sleep -Seconds 1 }
  $svc = Get-Service -Name UniWake
  Confirm-Condition ($svc.Status -eq 'Running') 'serviço UniWake em execução'
  Confirm-Condition ($svc.StartType -eq 'Automatic') 'início automático'
  $failure = (& sc.exe qfailure UniWake) -join "`n"
  Confirm-Condition ($failure -match 'RESTART') 'reinicia em caso de falha'
  Wait-Health 60
  Confirm-Condition (Test-FirewallRule 'UniWake Painel') 'regra de firewall do painel'
  Confirm-Condition (Test-FirewallRule 'UniWake Cadastro') 'regra de firewall do cadastro'
  Confirm-Condition (Test-TeamFirewallRule) 'regras do Modo equipe (TCP e UDP 47102, Domínio e Privada)'
  Confirm-Condition (Test-Path $shortcut) 'atalho no menu Iniciar'

  Write-Step 'Dados de exemplo'
  Invoke-Api 'POST' '/api/auth/setup' @{ username = 'admin'; password = $ciPassword } | Out-Null
  Invoke-Api 'POST' '/api/auth/login' @{ username = 'admin'; password = $ciPassword } | Out-Null
  $room = Invoke-Api 'POST' '/api/rooms' @{ name = 'Lab CI' }
  Invoke-Api 'POST' '/api/devices' @{ name = 'PC-CI'; mac = '00:1A:2B:3C:4D:5E'; roomId = $room.id } | Out-Null
  Confirm-Condition ((Invoke-Api 'GET' '/api/update').current -eq $V1) "versão $V1 em execução"

  # ------------------------------------------------------------------ AC-001-02
  Write-Step "Atualização para $V2 por cima"
  Install-Setup $V2Setup 'install-v2'
  Wait-Health 60
  Invoke-Api 'POST' '/api/auth/login' @{ username = 'admin'; password = $ciPassword } | Out-Null
  Confirm-Condition ((Invoke-Api 'GET' '/api/update').current -eq $V2) "versão $V2 em execução"
  Confirm-Condition (@((Invoke-Api 'GET' '/api/rooms') | Where-Object { $_.name -eq 'Lab CI' }).Count -eq 1) 'sala mantida'
  $devices = Invoke-Api 'GET' '/api/devices?all=1'
  Confirm-Condition (@($devices | Where-Object { $_.name -eq 'PC-CI' }).Count -eq 1) 'computador mantido'
  Confirm-Condition (Test-Path (Join-Path $appDir "versions\$V1")) 'versão anterior mantida para reverter'
  $node = Join-Path $appDir "versions\$V2\node.exe"
  $db = Join-Path $dataDir 'data\uniwake.db'
  $dup = & $node -e "const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(process.argv[1], { readOnly: true }); console.log(d.prepare('SELECT COUNT(*) AS n FROM (SELECT version FROM schema_migrations GROUP BY version HAVING COUNT(*) > 1)').get().n)" $db
  Confirm-Condition ($dup.Trim() -eq '0') 'cada migração rodou uma vez'

  # ------------------------------------------------------------------ AC-001-03
  Write-Step 'Desinstalação silenciosa'
  $uninstaller = Join-Path $appDir 'unins000.exe'
  Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -Wait
  $until = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $until -and (Get-Service -Name UniWake -ErrorAction SilentlyContinue)) { Start-Sleep -Seconds 2 }
  Confirm-Condition ($null -eq (Get-Service -Name UniWake -ErrorAction SilentlyContinue)) 'serviço removido'
  Confirm-Condition (-not (Test-FirewallRule 'UniWake Painel')) 'regra do painel removida'
  Confirm-Condition (-not (Test-FirewallRule 'UniWake Cadastro')) 'regra do cadastro removida'
  Confirm-Condition (-not (Test-FirewallRule 'UniWake - Modo equipe')) 'regras do Modo equipe removidas'
  Confirm-Condition (-not (Test-Path $shortcut)) 'atalho removido'
  Confirm-Condition (Test-Path $db) 'dados mantidos em %ProgramData%\UniWake'
  Write-Step 'Instalador: tudo certo'
} catch {
  Write-CiError $_
  Save-CiLog @($logs, (Join-Path $env:ProgramData 'UniWake\logs'))
  throw
}
# The last native command (netsh: "no such rule") sets $LASTEXITCODE, which the runner would return.
exit 0
