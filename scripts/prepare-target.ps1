<#
.SYNOPSIS
  Prepara este computador para ser ligado pelo UniWake (Wake-on-LAN) e o cadastra no painel.
.DESCRIPTION
  Copie o comando em "Preparar máquinas" no painel do UniWake e execute-o em um PowerShell aberto
  como Administrador. O script:
    1. encontra a placa de rede cabeada em uso;
    2. permite que ela ligue o computador, somente com Magic Packet;
    3. desativa a Inicialização Rápida (Fast Startup);
    4. ajusta as propriedades avançadas da placa (Wake on Magic Packet, ligar a partir do
       desligamento, Ethernet com eficiência energética desligada);
    5. libera o ping (ICMPv4) nas redes de domínio e privadas;
    6. mostra um resumo e a lista de verificação da BIOS;
    7. cadastra o computador no UniWake.
  Um registro de tudo fica em %ProgramData%\UniWake-Prepare\.
  Códigos de saída: 0 tudo certo, 1 alguma etapa falhou, 2 cadastro falhou, 3 sem administrador.
.PARAMETER HubUrl
  Endereço do UniWake para o cadastro, ex.: http://10.0.3.5:47101 (vem no comando do painel).
.PARAMETER RoomCode
  Código da sala, ex.: LAB3.
.PARAMETER Token
  Código de cadastro gerado no painel.
.PARAMETER SkipEnrollment
  Só prepara o computador, sem cadastrá-lo.
.PARAMETER NoFirewallChange
  Não altera o Firewall do Windows.
.EXAMPLE
  .\prepare-target.ps1 -WhatIf -SkipEnrollment
  Mostra o que seria alterado, sem alterar nada.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$HubUrl = '',
  [string]$RoomCode = '',
  [string]$Token = '',
  [switch]$SkipEnrollment,
  [switch]$NoFirewallChange
)

Set-StrictMode -Version 3.0

$script:UwStatus = @{
  Ok         = 'OK'
  Failed     = 'FALHOU'
  NotApplies = 'NÃO SE APLICA'
  Manual     = 'MANUAL'
  Planned    = 'PLANEJADO'
}
$script:UwSteps = New-Object System.Collections.Generic.List[object]

# ------------------------------------------------------------------ system access (mocked in tests)

function Test-UwElevated {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-UwNetAdapter {
  return @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue)
}

function Get-UwDefaultRouteIndex {
  return @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
      ForEach-Object { $_.InterfaceIndex })
}

function Open-UwTranscript {
  $dir = Join-Path $env:ProgramData 'UniWake-Prepare'
  New-Item -ItemType Directory -Force -Path $dir -WhatIf:$false | Out-Null
  $file = Join-Path $dir ('prepare-{0:yyyyMMdd-HHmmss}.log' -f (Get-Date))
  Start-Transcript -Path $file -WhatIf:$false | Out-Null
  return $file
}

function Close-UwTranscript {
  try { Stop-Transcript | Out-Null } catch { Write-Verbose 'Nenhum registro em andamento.' }
}

# ------------------------------------------------------------------ logic

function Add-UwStep {
  param([string]$Name, [string]$Status, [string]$Detail = '')
  $script:UwSteps.Add([pscustomobject]@{ Etapa = $Name; Resultado = $Status; Detalhe = $Detail })
}

<#
  FR-007.1 step 1: the connected wired physical adapter; with several, the one holding the default
  route. Wi-Fi, Bluetooth and virtual adapters never count.
#>
function Select-UwWiredAdapter {
  param([object[]]$Adapters, [int[]]$DefaultRouteIndexes)
  $skip = 'Wi-?Fi|Wireless|WLAN|802\.11|Bluetooth|Virtual|VPN|TAP-|Hyper-V|VMware|VirtualBox|Loopback'
  $wired = @($Adapters | Where-Object {
      $_.NdisPhysicalMedium -eq 14 -and -not $_.Virtual -and $_.InterfaceDescription -notmatch $skip
    })
  $up = @($wired | Where-Object { $_.Status -eq 'Up' } | Sort-Object -Property ifIndex)
  $chosen = @($up | Where-Object { $DefaultRouteIndexes -contains $_.ifIndex }) + $up |
    Select-Object -First 1
  return [pscustomobject]@{
    Chosen = $chosen
    Others = @($wired | Where-Object { -not $chosen -or $_.ifIndex -ne $chosen.ifIndex })
  }
}

function Write-UwSummary {
  Write-Host ''
  Write-Host '================ Resumo da preparação ================'
  foreach ($s in $script:UwSteps) {
    $color = switch ($s.Resultado) {
      'OK' { 'Green' }
      'FALHOU' { 'Red' }
      'PLANEJADO' { 'Cyan' }
      default { 'Yellow' }
    }
    $line = '[{0}] {1}' -f $s.Resultado, $s.Etapa
    if ($s.Detalhe) { $line += " - $($s.Detalhe)" }
    Write-Host $line -ForegroundColor $color
  }
  Write-Host ''
  Write-Host 'Verifique também na BIOS/UEFI (não dá para alterar por aqui):'
  Write-Host '  - Wake on LAN / Power On by PCI-E / Remote Wake Up: ativado'
  Write-Host '  - ErP / EuP / Deep Sleep / Economia de energia no desligamento: desativado'
  Write-Host '  - Dell: Power Management > Wake on LAN = LAN Only; Deep Sleep Control = Disabled'
  Write-Host '  - HP: Advanced > Power-On Options > Remote Wake Up Boot Source = Remote Server; S5 Wake on LAN = Enabled'
  Write-Host '  - Lenovo: Power > Wake on LAN = Automatic/Primary; Enhanced Power Saving Mode = Disabled'
  Write-Host '======================================================'
}

<#
  Runs every step and returns the exit code: 0 all OK, 1 partial, 2 enrollment failed,
  3 not elevated (FR-007.1).
#>
function Invoke-UwPrepare {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param(
    [string]$HubUrl = '',
    [string]$RoomCode = '',
    [string]$Token = '',
    [switch]$SkipEnrollment,
    [switch]$NoFirewallChange
  )
  $script:UwSteps.Clear()
  if (-not (Test-UwElevated)) {
    Write-Host 'Abra o PowerShell como Administrador e execute novamente.' -ForegroundColor Red
    return 3
  }
  if (-not $SkipEnrollment -and ($HubUrl -eq '' -or $RoomCode -eq '' -or $Token -eq '')) {
    Write-Host 'Faltam -HubUrl, -RoomCode e -Token: copie o comando completo em "Preparar máquinas" no painel, ou use -SkipEnrollment.' -ForegroundColor Red
    return 2
  }
  $log = Open-UwTranscript
  try {
    if ($WhatIfPreference) {
      Write-Host 'Modo simulação (-WhatIf): nada será alterado neste computador.' -ForegroundColor Cyan
    }
    $pick = Select-UwWiredAdapter -Adapters (Get-UwNetAdapter) -DefaultRouteIndexes (Get-UwDefaultRouteIndex)
    if (-not $pick.Chosen) {
      Add-UwStep 'Placa de rede cabeada' $script:UwStatus.Failed 'nenhuma placa cabeada conectada. Ligue o cabo de rede e execute novamente.'
    } else {
      $nic = $pick.Chosen
      Add-UwStep 'Placa de rede cabeada' $script:UwStatus.Ok ('{0} ({1}, {2})' -f $nic.Name, $nic.InterfaceDescription, $nic.MacAddress)
      foreach ($o in $pick.Others) {
        Write-Host ('Outra placa cabeada encontrada: {0} ({1}, {2}).' -f $o.Name, $o.InterfaceDescription, $o.Status)
      }
    }
    Write-UwSummary
    Write-Host "Registro desta execução: $log"
    $failed = @($script:UwSteps | Where-Object { $_.Resultado -eq $script:UwStatus.Failed }).Count
    if ($failed -gt 0) { return 1 }
    return 0
  } finally {
    Close-UwTranscript
  }
}

# Dot-sourcing (tests) only loads the functions above.
if ($MyInvocation.InvocationName -ne '.') {
  exit (Invoke-UwPrepare -HubUrl $HubUrl -RoomCode $RoomCode -Token $Token -SkipEnrollment:$SkipEnrollment -NoFirewallChange:$NoFirewallChange)
}
