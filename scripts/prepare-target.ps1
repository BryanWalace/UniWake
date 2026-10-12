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
    7. cadastra o computador no UniWake;
    8. com o comando da versão 1.3 (-HubKeyId), instala o desligamento remoto: duas tarefas
       agendadas do Windows e os scripts do agente (nenhum programa é instalado), ativa os
       temporizadores de ativação e só lê o tempo de suspensão.
  Um registro de tudo fica em %ProgramData%\UniWake-Prepare\.
  Códigos de saída: 0 tudo certo, 1 alguma etapa falhou, 2 cadastro falhou, 3 sem administrador.
.PARAMETER HubUrl
  Endereço do UniWake para o cadastro, ex.: http://10.0.3.5:47101 (vem no comando do painel).
.PARAMETER RoomCode
  Código da sala, ex.: LAB3.
.PARAMETER Token
  Código de cadastro gerado no painel.
.PARAMETER HubKeyId
  Identificação da chave do UniWake (vem no comando do painel): confere que a resposta veio dele.
.PARAMETER PersistentPath
  Pasta que sobrevive ao congelamento (ex.: ThawSpace do Deep Freeze, T:\UniWake) para a agenda.
.PARAMETER RemoveAgent
  Remove o desligamento remoto deste computador (tarefas e arquivos do agente).
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
  [switch]$NoFirewallChange,
  [string]$HubKeyId = '',
  [string]$PersistentPath = '',
  [switch]$RemoveAgent
)

Set-StrictMode -Version 3.0

$script:UwStatus = @{
  Ok         = 'OK'
  Failed     = 'FALHOU'
  NotApplies = 'NÃO SE APLICA'
  Manual     = 'MANUAL'
  Planned    = 'PLANEJADO'
  Attention  = 'ATENÇÃO'
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

function Get-UwSystemInfo {
  $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue
  $bios = Get-CimInstance -ClassName Win32_BIOS -ErrorAction SilentlyContinue
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue
  $release = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name DisplayVersion -ErrorAction SilentlyContinue
  $osText = if ($os) { "$($os.Caption)".Trim() } else { $null }
  if ($osText -and $release) { $osText = "$osText $($release.DisplayVersion)" }
  return [pscustomobject]@{
    Hostname     = $env:COMPUTERNAME
    Manufacturer = if ($cs) { $cs.Manufacturer } else { $null }
    Model        = if ($cs) { $cs.Model } else { $null }
    Serial       = if ($bios) { $bios.SerialNumber } else { $null }
    Os           = $osText
  }
}

function Get-UwIPv4Address([int]$InterfaceIndex) {
  return Get-NetIPAddress -InterfaceIndex $InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '169.254.*' } |
    Select-Object -First 1 -ExpandProperty IPAddress
}

function Send-UwEnrollment {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$Uri, [string]$Token, [string]$Json)
  if (-not $PSCmdlet.ShouldProcess($Uri, 'Cadastrar este computador')) { return $null }
  $body = [Text.Encoding]::UTF8.GetBytes($Json)
  return Invoke-RestMethod -Method Post -Uri $Uri -UseBasicParsing -TimeoutSec 30 -Headers @{ Authorization = "Bearer $Token" } -ContentType 'application/json; charset=utf-8' -Body $body -ErrorAction Stop
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

<# The hub's pt-BR error message from a failed request, else the exception text. #>
function Get-UwErrorMessage {
  param([System.Management.Automation.ErrorRecord]$ErrorRecord)
  $details = $ErrorRecord.ErrorDetails
  if ($details -and $details.Message) {
    try {
      $parsed = $details.Message | ConvertFrom-Json -ErrorAction Stop
      if ($parsed.message) { return "$($parsed.message)" }
    } catch {
      Write-Verbose 'Resposta de erro sem JSON.'
    }
  }
  return $ErrorRecord.Exception.Message
}

<# FR-007.1 step 7 / FR-007.2: report this computer to the hub. Returns $false on failure. #>
function Invoke-UwEnrollStep {
  param([object]$Nic, [object[]]$Adapters, [string]$HubUrl, [string]$RoomCode, [string]$Token, [string]$HubKeyId = '')
  $name = 'Cadastro no UniWake'
  if (-not $Nic) {
    Add-UwStep $name $script:UwStatus.Failed 'sem placa de rede cabeada para cadastrar'
    return $false
  }
  if ($WhatIfPreference) {
    Add-UwStep $name $script:UwStatus.Planned "sala $RoomCode em $HubUrl"
    return $true
  }
  $info = Get-UwSystemInfo
  $results = [ordered]@{}
  foreach ($st in $script:UwSteps) {
    $text = if ($st.Detalhe) { '{0}: {1}' -f $st.Resultado, $st.Detalhe } else { $st.Resultado }
    if ($text.Length -gt 250) { $text = $text.Substring(0, 250) }
    $results[$st.Etapa] = $text
  }
  $body = [ordered]@{
    roomCode       = $RoomCode
    mac            = $Nic.MacAddress
    otherMacs      = @($Adapters | Where-Object { $_.ifIndex -ne $Nic.ifIndex -and $_.MacAddress } | ForEach-Object { $_.MacAddress })
    hostname       = $info.Hostname
    ip             = Get-UwIPv4Address $Nic.ifIndex
    manufacturer   = $info.Manufacturer
    model          = $info.Model
    serial         = $info.Serial
    os             = $info.Os
    prepareResults = $results
  }
  $uri = '{0}/agent/enroll' -f $HubUrl.TrimEnd('/')
  try {
    if ($HubKeyId) {
      # v1.3: also ask for this computer's agent token; the answer is signed over this nonce.
      $script:UwEnrollNonce = Get-UwNonce
      $body['agent'] = [ordered]@{ protocol = 1; nonce = $script:UwEnrollNonce }
      $script:UwEnrollAnswer = Send-UwAgentEnrollment -Uri $uri -Token $Token -Json (ConvertTo-Json $body -Compress -Depth 4)
      $r = [Text.Encoding]::UTF8.GetString($script:UwEnrollAnswer.Body) | ConvertFrom-Json
    } else {
      $r = Send-UwEnrollment -Uri $uri -Token $Token -Json (ConvertTo-Json $body -Compress -Depth 4)
    }
    Add-UwStep $name $script:UwStatus.Ok "$($r.message)"
    return $true
  } catch {
    Add-UwStep $name $script:UwStatus.Failed (Get-UwErrorMessage $_)
    return $false
  }
}

# ------------------------------------------------------------------ remote shutdown (v1.3, FR-301, ADR-042..047)

$script:UwAgentRoot = Join-Path $env:ProgramData 'UniWake'
$script:UwAgentScripts = @('uniwake-agent.ps1', 'uniwake-aviso.ps1')
$script:UwEnrollAnswer = $null
$script:UwEnrollNonce = ''

# Pure helpers (also in the agent; both are checked against the shared signature fixture).
function ConvertFrom-UwBase64Url {
  param([string]$Text)
  $b64 = $Text.Replace('-', '+').Replace('_', '/')
  switch ($b64.Length % 4) {
    2 { $b64 += '==' }
    3 { $b64 += '=' }
  }
  , [Convert]::FromBase64String($b64)
}

function ConvertTo-UwBase64Url {
  param([byte[]]$Bytes)
  [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-UwSha256Hex {
  param([byte[]]$Bytes)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { -join ($sha.ComputeHash($Bytes) | ForEach-Object { $_.ToString('x2') }) } finally { $sha.Dispose() }
}

# RFC 7638 thumbprint of the hub's key: what -HubKeyId pins (ADR-044).
function Get-UwKeyId {
  param([string]$N, [string]$E)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    ConvertTo-UwBase64Url ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes('{"e":"' + $E + '","kty":"RSA","n":"' + $N + '"}')))
  } finally {
    $sha.Dispose()
  }
}

function Test-UwSignature {
  param([byte[]]$Body, [string]$Nonce, [string]$Signature, [string]$N, [string]$E)
  try {
    $prefix = [Text.Encoding]::UTF8.GetBytes("uniwake-agent-v1`n$Nonce`n")
    $data = New-Object byte[] ($prefix.Length + $Body.Length)
    [Array]::Copy($prefix, 0, $data, 0, $prefix.Length)
    [Array]::Copy($Body, 0, $data, $prefix.Length, $Body.Length)
    $p = New-Object Security.Cryptography.RSAParameters
    $p.Modulus = ConvertFrom-UwBase64Url $N
    $p.Exponent = ConvertFrom-UwBase64Url $E
    $rsa = New-Object Security.Cryptography.RSACng
    try {
      $rsa.ImportParameters($p)
      return $rsa.VerifyData($data, [Convert]::FromBase64String($Signature),
        [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    } finally {
      $rsa.Dispose()
    }
  } catch {
    return $false
  }
}

function Get-UwNonce {
  $bytes = New-Object byte[] 16
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  ConvertTo-UwBase64Url $bytes
}

<#
  AC and DC indexes from `powercfg /QUERY <scheme> <subgroup> <setting>`. The labels are localized
  (pt-BR Windows prints Portuguese), so only the hex values are read: the last two are the current
  AC and DC indexes (ADR-045).
#>
function ConvertFrom-UwPowercfgOutput {
  param([string[]]$Lines)
  $hex = @($Lines | ForEach-Object { if ($_ -match ':\s*0x([0-9a-fA-F]+)\s*$') { [Convert]::ToInt64($Matches[1], 16) } })
  if ($hex.Count -lt 2) { return $null }
  return @{ Ac = $hex[$hex.Count - 2]; Dc = $hex[$hex.Count - 1] }
}

# System access for the step (mocked in tests).

<# Enrollment that keeps the exact answer bytes and headers: the agent part is signed (ADR-044). #>
function Send-UwAgentEnrollment {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$Uri, [string]$Token, [string]$Json)
  if (-not $PSCmdlet.ShouldProcess($Uri, 'Cadastrar este computador')) { return $null }
  $r = Invoke-WebRequest -Method Post -Uri $Uri -UseBasicParsing -TimeoutSec 30 -Headers @{ Authorization = "Bearer $Token" } -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($Json)) -ErrorAction Stop
  $headers = @{}
  foreach ($k in $r.Headers.Keys) { $headers[$k.ToLowerInvariant()] = [string]$r.Headers[$k] }
  return @{ Body = $r.RawContentStream.ToArray(); Headers = $headers }
}

function Get-UwAgentScriptContent {
  param([string]$Uri)
  , (Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop).RawContentStream.ToArray()
}

<#
  C:\ProgramData lets users create folders, so the agent folder is taken over and locked down
  (ADR-042): owner Administrators, no inherited rules, Administrators and SYSTEM full control.
  ui\request: users may read; ui\response: users may create files and change only their own.
#>
function Initialize-UwAgentFolder {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$Root)
  if (-not $PSCmdlet.ShouldProcess($Root, 'Criar a pasta do agente com permissões restritas')) { return }
  $admins = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
  $system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
  $users = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')
  $creator = New-Object Security.Principal.SecurityIdentifier('S-1-3-0')
  $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $none = [Security.AccessControl.PropagationFlags]::None
  $lock = {
    param($path, $extra)
    if (-not (Test-Path -LiteralPath $path)) { New-Item -ItemType Directory -Force -Path $path | Out-Null }
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($admins)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in $admins, $system) {
      $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inherit, $none, 'Allow')))
    }
    foreach ($rule in $extra) { $acl.AddAccessRule($rule) }
    Set-Acl -LiteralPath $path -AclObject $acl
  }
  & $lock $Root @()
  & $lock (Join-Path $Root 'agent') @()
  & $lock (Join-Path $Root 'agent\data') @()
  $read = New-Object Security.AccessControl.FileSystemAccessRule($users, 'ReadAndExecute', $inherit, $none, 'Allow')
  & $lock (Join-Path $Root 'ui') @($read)
  & $lock (Join-Path $Root 'ui\request') @($read)
  $create = New-Object Security.AccessControl.FileSystemAccessRule($users, 'ReadAndExecute, CreateFiles', 'None', $none, 'Allow')
  $own = New-Object Security.AccessControl.FileSystemAccessRule($creator, 'Modify', $inherit, 'InheritOnly', 'Allow')
  & $lock (Join-Path $Root 'ui\response') @($create, $own)
}

<# Writes one agent file; only the warning script is readable by users (ADR-046). #>
function Write-UwAgentFile {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$Path, [byte[]]$Bytes, [switch]$UsersRead)
  if (-not $PSCmdlet.ShouldProcess($Path, 'Gravar arquivo do agente')) { return }
  [IO.File]::WriteAllBytes("$Path.tmp", $Bytes)
  Move-Item -LiteralPath "$Path.tmp" -Destination $Path -Force
  if ($UsersRead) {
    $acl = Get-Acl -LiteralPath $Path
    $users = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($users, 'ReadAndExecute', 'Allow')))
    Set-Acl -LiteralPath $Path -AclObject $acl
  }
}


<#
  The three tasks of ADR-042/045/046: "UniWake" (SYSTEM, at start-up and every minute, never wakes
  the PC), "UniWake Despertar" (SYSTEM, wakes the PC; triggers written by the agent) and
  "UniWake Aviso" (logged-on users, shows the warning).
#>
function Register-UwAgentTask {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$AgentDir)
  if (-not $PSCmdlet.ShouldProcess('UniWake, UniWake Despertar, UniWake Aviso', 'Registrar tarefas agendadas')) { return }
  $agent = Join-Path $AgentDir 'uniwake-agent.ps1'
  $aviso = Join-Path $AgentDir 'uniwake-aviso.ps1'
  $run = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$agent`""
  $system = New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -RunLevel Highest
  $base = @{ AllowStartIfOnBatteries = $true; DontStopIfGoingOnBatteries = $true; StartWhenAvailable = $true; MultipleInstances = 'IgnoreNew' }

  $every = New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 1)
  $settings = New-ScheduledTaskSettingsSet @base -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  Register-ScheduledTask -TaskName 'UniWake' -Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $run) `
    -Trigger @((New-ScheduledTaskTrigger -AtStartup), $every) -Settings $settings -Principal $system -Force | Out-Null

  $wakeSettings = New-ScheduledTaskSettingsSet @base -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  Register-ScheduledTask -TaskName 'UniWake Despertar' -Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "$run -Wake") `
    -Trigger (New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddYears(5))) -Settings $wakeSettings -Principal $system -Force | Out-Null

  $users = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545'
  $avisoAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$aviso`""
  Register-ScheduledTask -TaskName 'UniWake Aviso' -Action $avisoAction -Trigger (New-ScheduledTaskTrigger -AtLogOn) `
    -Settings (New-ScheduledTaskSettingsSet @base -ExecutionTimeLimit (New-TimeSpan -Hours 3)) -Principal $users -Force | Out-Null
}

function Start-UwAgentTask {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param()
  if ($PSCmdlet.ShouldProcess('UniWake', 'Executar a tarefa agora (primeira consulta)')) { Start-ScheduledTask -TaskName 'UniWake' }
}

function Unregister-UwAgentTask {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param()
  foreach ($name in 'UniWake', 'UniWake Despertar', 'UniWake Aviso') {
    if ((Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) -and $PSCmdlet.ShouldProcess($name, 'Remover tarefa agendada')) {
      Unregister-ScheduledTask -TaskName $name -Confirm:$false
    }
  }
}

function Remove-UwAgentFolder {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$Root)
  if ((Test-Path -LiteralPath $Root) -and $PSCmdlet.ShouldProcess($Root, 'Remover arquivos do agente')) {
    Remove-Item -LiteralPath $Root -Recurse -Force
  }
}

function Get-UwPowercfg {
  param([string]$Subgroup, [string]$Setting)
  ConvertFrom-UwPowercfgOutput -Lines @(& powercfg.exe /QUERY SCHEME_CURRENT $Subgroup $Setting 2>$null)
}

function Set-UwWakeTimer {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param()
  if (-not $PSCmdlet.ShouldProcess('Plano de energia ativo', 'Permitir temporizadores de ativação (na tomada)')) { return }
  & powercfg.exe /SETACVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1 | Out-Null
  & powercfg.exe /SETACTIVE SCHEME_CURRENT | Out-Null
}

# Freezing software (FR-308.1, ADR-047): filled in by M18-T06.
function Get-UwFreezeState {
  return @{ product = $null; state = 'unverified' }
}

<#
  FR-301.1 / Q-3: wake timers enabled on AC (idempotent), sleep timeout only read. Two summary lines.
#>
function Invoke-UwPowerPlanStep {
  $timers = Get-UwPowercfg 'SUB_SLEEP' 'RTCWAKE'
  if ($null -eq $timers) {
    Add-UwStep 'Temporizadores de ativação' $script:UwStatus.Failed 'não foi possível ler o plano de energia (powercfg)'
  } elseif ($timers.Ac -eq 1) {
    Add-UwStep 'Temporizadores de ativação' $script:UwStatus.Ok 'já estavam ativados'
  } elseif ($WhatIfPreference) {
    Add-UwStep 'Temporizadores de ativação' $script:UwStatus.Planned 'ativar na tomada'
  } else {
    try {
      Set-UwWakeTimer
      Add-UwStep 'Temporizadores de ativação' $script:UwStatus.Ok 'ativados (na tomada)'
    } catch {
      Add-UwStep 'Temporizadores de ativação' $script:UwStatus.Failed $_.Exception.Message
    }
  }
  $sleep = Get-UwPowercfg 'SUB_SLEEP' 'STANDBYIDLE'
  $text = 'desconhecida'
  if ($null -ne $sleep) {
    if ($sleep.Ac -eq 0) { $text = 'nunca' } else { $text = "após $([Math]::Round($sleep.Ac / 60)) min" }
  }
  Add-UwStep 'Suspensão (na tomada)' $script:UwStatus.Ok $text
}

<#
  FR-301.1: the "Desligamento remoto" step. Needs the agent part of the enrollment answer, signed
  by the hub key pinned in the command (-HubKeyId). Writes the agent scripts (hashes from the
  signed answer), the token and the hub list, registers the tasks and starts the first check-in.
#>
function Invoke-UwRemoteShutdownStep {
  param([string]$HubUrl, [string]$HubKeyId, [string]$Nonce, [string]$PersistentPath)
  $name = 'Desligamento remoto'
  if (-not $HubKeyId) {
    Add-UwStep $name $script:UwStatus.NotApplies 'comando antigo: copie o comando atualizado em "Preparar máquinas" para ativar o desligamento remoto'
    return
  }
  if ($WhatIfPreference) {
    Add-UwStep $name $script:UwStatus.Planned "pasta $script:UwAgentRoot, tarefas UniWake, UniWake Despertar e UniWake Aviso"
    Invoke-UwPowerPlanStep
    return
  }
  $raw = $script:UwEnrollAnswer
  if ($null -eq $raw) {
    Add-UwStep $name $script:UwStatus.NotApplies 'o cadastro não foi feito'
    return
  }
  $answer = [Text.Encoding]::UTF8.GetString($raw.Body) | ConvertFrom-Json
  if (-not ($answer.PSObject.Properties.Name -contains 'agent')) {
    $why = 'o UniWake não oferece desligamento remoto (atualize o UniWake para a versão 1.3 ou mais nova)'
    if ($answer.PSObject.Properties.Name -contains 'agentUnavailable') { $why = [string]$answer.agentUnavailable }
    Add-UwStep $name $script:UwStatus.NotApplies $why
    return
  }
  $a = $answer.agent
  $sig = [string]$raw.Headers['x-uniwake-signature']
  $keyOk = $a.keyId -eq $HubKeyId -and (Get-UwKeyId $a.hubKey.n $a.hubKey.e) -eq $HubKeyId -and [string]$raw.Headers['x-uniwake-key'] -eq $HubKeyId
  if (-not $keyOk -or -not $sig -or -not (Test-UwSignature $raw.Body $Nonce $sig $a.hubKey.n $a.hubKey.e)) {
    Add-UwStep $name $script:UwStatus.Failed 'a resposta não confere com a chave do comando copiado do painel (rede não confiável?). Nada foi instalado.'
    return
  }
  try {
    $files = @{}
    foreach ($s in $script:UwAgentScripts) {
      $bytes = Get-UwAgentScriptContent ('{0}/agent/v1/scripts/{1}' -f $HubUrl.TrimEnd('/'), $s)
      if ((Get-UwSha256Hex $bytes) -ne [string]$a.scripts.$s.sha256) {
        Add-UwStep $name $script:UwStatus.Failed "o arquivo $s chegou alterado (não confere com o UniWake). Nada foi instalado."
        return
      }
      $files[$s] = $bytes
    }
    Initialize-UwAgentFolder -Root $script:UwAgentRoot
    $dir = Join-Path $script:UwAgentRoot 'agent'
    foreach ($s in $script:UwAgentScripts) {
      Write-UwAgentFile -Path (Join-Path $dir $s) -Bytes $files[$s] -UsersRead:($s -eq 'uniwake-aviso.ps1')
    }
    Write-UwAgentFile -Path (Join-Path $dir 'token.txt') -Bytes ([Text.Encoding]::ASCII.GetBytes([string]$a.token))
    $config = [ordered]@{
      protocol = 1; epoch = 0
      persistentPath = $(if ($PersistentPath) { $PersistentPath } else { $null })
      hubs = @([ordered]@{ instanceId = $null; urls = @($HubUrl.TrimEnd('/')); keyId = $HubKeyId; publicKey = $a.hubKey })
    }
    Write-UwAgentFile -Path (Join-Path $dir 'config.json') -Bytes ([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $config -Depth 6 -Compress)))
    Register-UwAgentTask -AgentDir $dir
    Invoke-UwPowerPlanStep
    $freeze = Get-UwFreezeState
    if ($freeze.state -eq 'frozen') {
      Add-UwStep $name 'ATENÇÃO' ("a máquina está congelada ($($freeze.product)): descongele (Thawed / modo manutenção), execute o comando de novo e congele outra vez")
    } else {
      Start-UwAgentTask
      Add-UwStep $name $script:UwStatus.Ok 'tarefas instaladas; a primeira consulta ao UniWake começou'
    }
  } catch {
    Add-UwStep $name $script:UwStatus.Failed $_.Exception.Message
  }
}

<# FR-301.3: -RemoveAgent takes the tasks, scripts and token away (revoke it in the panel too). #>
function Invoke-UwRemoveAgent {
  try {
    Unregister-UwAgentTask
    Remove-UwAgentFolder -Root $script:UwAgentRoot
    $status = $script:UwStatus.Ok
    if ($WhatIfPreference) { $status = $script:UwStatus.Planned }
    Add-UwStep 'Remover desligamento remoto' $status 'tarefas e arquivos do agente removidos. No painel, use "Revogar desligamento remoto" nesta máquina.'
    return 0
  } catch {
    Add-UwStep 'Remover desligamento remoto' $script:UwStatus.Failed $_.Exception.Message
    return 1
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
    [switch]$NoFirewallChange,
    [string]$HubKeyId = '',
    [string]$PersistentPath = '',
    [switch]$RemoveAgent
  )
  $script:UwSteps.Clear()
  $script:UwEnrollAnswer = $null
  if (-not (Test-UwElevated)) {
    Write-Host 'Abra o PowerShell como Administrador e execute novamente.' -ForegroundColor Red
    return 3
  }
  if ($RemoveAgent) {
    $log = Open-UwTranscript
    try {
      $code = Invoke-UwRemoveAgent
      Write-UwSummary
      Write-Host "Registro desta execução: $log"
      return $code
    } finally {
      Close-UwTranscript
    }
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
    $adapters = @(Get-UwNetAdapter)
    $pick = Select-UwWiredAdapter -Adapters $adapters -DefaultRouteIndexes (Get-UwDefaultRouteIndex)
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
    $enrolled = $true
    if ($SkipEnrollment) {
      Add-UwStep 'Cadastro no UniWake' $script:UwStatus.NotApplies 'ignorado (-SkipEnrollment)'
    } else {
      $enrolled = Invoke-UwEnrollStep -Nic $pick.Chosen -Adapters $adapters -HubUrl $HubUrl -RoomCode $RoomCode -Token $Token -HubKeyId $HubKeyId
      if ($enrolled) {
        Invoke-UwRemoteShutdownStep -HubUrl $HubUrl -HubKeyId $HubKeyId -Nonce $script:UwEnrollNonce -PersistentPath $PersistentPath
      }
    }
    Write-UwSummary
    Write-Host "Registro desta execução: $log"
    if (-not $enrolled) { return 2 }
    $failed = @($script:UwSteps | Where-Object { $_.Resultado -eq $script:UwStatus.Failed }).Count
    if ($failed -gt 0) { return 1 }
    return 0
  } finally {
    Close-UwTranscript
  }
}

# Dot-sourcing (tests) only loads the functions above.
if ($MyInvocation.InvocationName -ne '.') {
  exit (Invoke-UwPrepare -HubUrl $HubUrl -RoomCode $RoomCode -Token $Token -SkipEnrollment:$SkipEnrollment -NoFirewallChange:$NoFirewallChange -HubKeyId $HubKeyId -PersistentPath $PersistentPath -RemoveAgent:$RemoveAgent)
}
