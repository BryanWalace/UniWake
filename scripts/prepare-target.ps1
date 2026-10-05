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

function Get-UwPowerManagement([string]$Name) {
  return Get-NetAdapterPowerManagement -Name $Name -ErrorAction Stop
}

function Set-UwPowerManagement {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$Name)
  if ($PSCmdlet.ShouldProcess($Name, 'Wake on Magic Packet ativado, Wake on Pattern desativado')) {
    Set-NetAdapterPowerManagement -Name $Name -WakeOnMagicPacket Enabled -WakeOnPattern Disabled -NoRestart -ErrorAction Stop
  }
}

function Get-UwWakeArmedDevice {
  return @(& powercfg.exe /devicequery wake_armed 2>$null)
}

function Enable-UwDeviceWake {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$Description)
  if ($PSCmdlet.ShouldProcess($Description, 'Permitir que este dispositivo ative o computador')) {
    & powercfg.exe /deviceenablewake $Description | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "powercfg /deviceenablewake terminou com código $LASTEXITCODE." }
  }
}

$script:UwPowerKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power'

function Get-UwHiberboot {
  $p = Get-ItemProperty -Path $script:UwPowerKey -Name HiberbootEnabled -ErrorAction SilentlyContinue
  if ($null -eq $p) { return $null }
  return [int]$p.HiberbootEnabled
}

function Set-UwHiberboot {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param()
  if ($PSCmdlet.ShouldProcess('HiberbootEnabled', 'Desativar a Inicialização Rápida')) {
    Set-ItemProperty -Path $script:UwPowerKey -Name HiberbootEnabled -Value 0 -Type DWord -ErrorAction Stop
  }
}

function Get-UwAdvancedProperty([string]$Name) {
  return @(Get-NetAdapterAdvancedProperty -Name $Name -AllProperties -ErrorAction SilentlyContinue)
}

function Set-UwAdvancedProperty {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$Name, [string]$Keyword, [string]$Value)
  if ($PSCmdlet.ShouldProcess("$Name $Keyword", "valor $Value")) {
    # -NoRestart: restarting the adapter would drop the network before enrollment; the new value
    # applies from the next boot, which is when it matters.
    Set-NetAdapterAdvancedProperty -Name $Name -RegistryKeyword $Keyword -RegistryValue $Value -NoRestart -ErrorAction Stop
  }
}

$script:UwIcmpRuleName = 'UniWake-ICMPv4-In'

function Get-UwIcmpRule {
  return Get-NetFirewallRule -Name $script:UwIcmpRuleName -ErrorAction SilentlyContinue
}

function Set-UwIcmpRule {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([bool]$Exists)
  if (-not $PSCmdlet.ShouldProcess($script:UwIcmpRuleName, 'Permitir ping (ICMPv4) nas redes de domínio e privadas')) { return }
  if ($Exists) {
    Set-NetFirewallRule -Name $script:UwIcmpRuleName -Enabled True -Action Allow -Profile Domain, Private -ErrorAction Stop
  } else {
    New-NetFirewallRule -Name $script:UwIcmpRuleName -DisplayName 'UniWake - Ping (ICMPv4)' -Description 'Criada pelo prepare-target.ps1 do UniWake (ADR-028).' -Direction Inbound -Protocol ICMPv4 -IcmpType 8 -Action Allow -Profile Domain, Private -Enabled True -ErrorAction Stop | Out-Null
  }
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

<# FR-007.1 step 2: "Permitir que este dispositivo ative o computador" + "Somente Magic Packet". #>
function Invoke-UwWakeStep {
  param([object]$Nic)
  $name = 'Placa pode ligar o computador (somente Magic Packet)'
  try {
    $pm = Get-UwPowerManagement $Nic.Name
  } catch {
    Add-UwStep $name $script:UwStatus.NotApplies 'a placa não informa opções de energia'
    return
  }
  if ("$($pm.WakeOnMagicPacket)" -eq 'Unsupported') {
    Add-UwStep $name $script:UwStatus.NotApplies 'a placa não suporta Magic Packet'
    return
  }
  $armed = @(Get-UwWakeArmedDevice) -contains $Nic.InterfaceDescription
  $magicOk = "$($pm.WakeOnMagicPacket)" -eq 'Enabled'
  $patternOk = @('Disabled', 'Unsupported') -contains "$($pm.WakeOnPattern)"
  if ($armed -and $magicOk -and $patternOk) {
    Add-UwStep $name $script:UwStatus.Ok 'já estava configurado'
    return
  }
  if ($WhatIfPreference) {
    Add-UwStep $name $script:UwStatus.Planned 'ativar ligar pela rede e aceitar só Magic Packet'
    return
  }
  try {
    if (-not ($magicOk -and $patternOk)) { Set-UwPowerManagement -Name $Nic.Name }
    if (-not $armed) { Enable-UwDeviceWake -Description $Nic.InterfaceDescription }
    Add-UwStep $name $script:UwStatus.Ok 'ativado'
  } catch {
    Add-UwStep $name $script:UwStatus.Failed $_.Exception.Message
  }
}

<# FR-007.1 step 3: Fast Startup keeps the NIC from arming for wake on shutdown. #>
function Invoke-UwFastStartupStep {
  $name = 'Inicialização Rápida (Fast Startup) desativada'
  if ((Get-UwHiberboot) -eq 0) {
    Add-UwStep $name $script:UwStatus.Ok 'já estava desativada'
    return
  }
  if ($WhatIfPreference) {
    Add-UwStep $name $script:UwStatus.Planned 'desativar (HiberbootEnabled = 0)'
    return
  }
  try {
    Set-UwHiberboot
    Add-UwStep $name $script:UwStatus.Ok 'desativada'
  } catch {
    Add-UwStep $name $script:UwStatus.Failed $_.Exception.Message
  }
}

$script:UwOnValue = '^(Enabled|On|Ativado|Ativada|Habilitado|Habilitada|Ligado|Ligada)$'
$script:UwOffValue = '^(Disabled|Off|Desativado|Desativada|Desabilitado|Desabilitada|Desligado|Desligada)$'

# FR-007.1 step 4. Drivers name these differently; standard keywords first, display names second.
$script:UwAdvancedTargets = @(
  @{
    Label = 'Wake on Magic Packet'; Want = 'on'
    Keywords = @('*WakeOnMagicPacket')
    Display = 'Wake on Magic Packet$|^Magic Packet'
  },
  @{
    Label = 'Ligar a partir do desligamento (Shutdown Wake-On-LAN)'; Want = 'on'
    Keywords = @('S5WakeOnLan', '*S5WakeOnLan', 'WakeFromS5', 'EnablePME')
    Display = 'Shutdown Wake|Wake from (power.?off|S5)|power off state|Enable PME'
  },
  @{
    Label = 'Ethernet com eficiência energética desligada (EEE / Green Ethernet)'; Want = 'off'
    Keywords = @('*EEE', 'EEE', 'AdvancedEEE', 'EEELinkAdvertisement', 'EnableGreenEthernet', '*GreenEthernet')
    Display = 'Energy.?Efficient|Green Ethernet|\bEEE\b'
  }
)

<# The registry value that means on/off for this property, or $null when it cannot be told. #>
function Get-UwWantedValue {
  param([object]$Property, [string]$Want)
  $pattern = if ($Want -eq 'on') { $script:UwOnValue } else { $script:UwOffValue }
  $display = @($Property.ValidDisplayValues)
  $values = @($Property.ValidRegistryValues)
  for ($i = 0; $i -lt $display.Count -and $i -lt $values.Count; $i++) {
    if ("$($display[$i])" -match $pattern) { return "$($values[$i])" }
  }
  $fallback = if ($Want -eq 'on') { '1' } else { '0' }
  if ($values -contains $fallback) { return $fallback }
  return $null
}

function Invoke-UwAdvancedStep {
  param([object]$Nic)
  $all = @(Get-UwAdvancedProperty $Nic.Name)
  foreach ($t in $script:UwAdvancedTargets) {
    $props = @($all | Where-Object {
        $t.Keywords -contains $_.RegistryKeyword -or "$($_.DisplayName)" -match $t.Display
      })
    if ($props.Count -eq 0) {
      Add-UwStep $t.Label $script:UwStatus.NotApplies 'a placa não tem esta opção'
      continue
    }
    $changes = @()
    $manual = @()
    foreach ($p in $props) {
      $wanted = Get-UwWantedValue -Property $p -Want $t.Want
      if ($null -eq $wanted) { $manual += "$($p.DisplayName)"; continue }
      if ("$(@($p.RegistryValue)[0])" -ne $wanted) {
        $changes += [pscustomobject]@{ Keyword = $p.RegistryKeyword; Value = $wanted; Display = $p.DisplayName }
      }
    }
    if ($manual.Count -gt 0 -and $changes.Count -eq 0) {
      Add-UwStep $t.Label $script:UwStatus.Manual ('ajuste manualmente em Gerenciador de Dispositivos: {0}' -f ($manual -join ', '))
      continue
    }
    if ($changes.Count -eq 0) {
      Add-UwStep $t.Label $script:UwStatus.Ok 'já estava configurado'
      continue
    }
    if ($WhatIfPreference) {
      Add-UwStep $t.Label $script:UwStatus.Planned (($changes | ForEach-Object { $_.Display }) -join ', ')
      continue
    }
    try {
      foreach ($c in $changes) { Set-UwAdvancedProperty -Name $Nic.Name -Keyword $c.Keyword -Value $c.Value }
      Add-UwStep $t.Label $script:UwStatus.Ok 'ajustado (vale a partir da próxima inicialização)'
    } catch {
      Add-UwStep $t.Label $script:UwStatus.Failed $_.Exception.Message
    }
  }
}

<# FR-007.1 step 5 (ADR-028): our own ping rule, Domain and Private only. #>
function Invoke-UwIcmpStep {
  param([switch]$NoFirewallChange)
  $name = 'Ping (ICMPv4) liberado nas redes de domínio e privadas'
  if ($NoFirewallChange) {
    Add-UwStep $name $script:UwStatus.NotApplies 'ignorado (-NoFirewallChange)'
    return
  }
  $rule = Get-UwIcmpRule
  if ($rule -and "$($rule.Enabled)" -eq 'True' -and "$($rule.Action)" -eq 'Allow' -and "$($rule.Profile)" -eq 'Domain, Private') {
    Add-UwStep $name $script:UwStatus.Ok 'já estava liberado'
    return
  }
  if ($WhatIfPreference) {
    Add-UwStep $name $script:UwStatus.Planned "regra $($script:UwIcmpRuleName)"
    return
  }
  try {
    Set-UwIcmpRule -Exists ([bool]$rule)
    Add-UwStep $name $script:UwStatus.Ok "regra $($script:UwIcmpRuleName)"
  } catch {
    Add-UwStep $name $script:UwStatus.Failed $_.Exception.Message
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
      Invoke-UwWakeStep -Nic $nic
    }
    Invoke-UwFastStartupStep
    if ($pick.Chosen) { Invoke-UwAdvancedStep -Nic $pick.Chosen }
    Invoke-UwIcmpStep -NoFirewallChange:$NoFirewallChange
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
