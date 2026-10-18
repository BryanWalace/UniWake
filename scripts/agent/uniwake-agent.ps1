<#
.SYNOPSIS
  UniWake agent for lab PCs (v1.3, ADR-042). Run by the scheduled task "UniWake" as SYSTEM, at
  startup and every minute, and by "UniWake Despertar" when the PC wakes for a shutdown.
.DESCRIPTION
  Pulls orders and the shutdown agenda from the hub and runs them, also while the hub is off.
  Built-in Windows components only (PowerShell 5.1, .NET Framework, Task Scheduler, shutdown.exe).
  Nothing the hub sends is used unless its signature verifies (ADR-044). Every call that touches
  the computer goes through a wrapper below; tests mock them and the wrappers refuse to run unless
  the agent was started for real (Invoke-UwAgent).
#>
[CmdletBinding()]
param(
  # Started by "UniWake Despertar" (the PC was woken for an agenda item).
  [switch]$Wake
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:UwAgentVersion = '1.7.0'
# Install steps this script applies on the machine itself (FR-603.3, ADR-059): Invoke-UwSelfInstall.
$script:UwInstallLevel = 3
# Windows error codes of a write refused by the antivirus (ERROR_VIRUS_INFECTED, ERROR_VIRUS_DELETED).
$script:UwVirusCodes = @(225, 226)
$script:UwProtocol = 1
$script:UwRoot = Join-Path $env:ProgramData 'UniWake'
$script:UwAgentDir = Join-Path $script:UwRoot 'agent'
$script:UwDataDir = Join-Path $script:UwAgentDir 'data'
$script:UwUiDir = Join-Path $script:UwRoot 'ui'
# Wrappers only touch the computer after Invoke-UwAgent sets this (never when dot-sourced by tests).
$script:UwRealSystem = $false
$script:UwIgnorePersistent = $false

$script:UwMinute = 60000L
$script:UwLateWakeMaxMinutes = 60
$script:UwSleepGapMs = 3L * 60000
$script:UwMaxQueuedReports = 500
$script:UwMaxReportsPerCheckin = 50
# One timeout per request (HttpWebRequest has no separate connect timeout) and at most 3 attempts
# per run, so a run with every hub PC off ends in about 15 s of waiting (plan §15.7, NFR-302). The
# hub that answered last lists itself first, so it is tried first.
$script:UwHttpTimeoutMs = 5000
$script:UwMaxHubAttempts = 3

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

function Get-UwSha256Hex {
  [CmdletBinding()]
  [OutputType([string])]
  param([Parameter(Mandatory)][AllowEmptyCollection()][byte[]]$Bytes)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    -join ($sha.ComputeHash($Bytes) | ForEach-Object { $_.ToString('x2') })
  } finally {
    $sha.Dispose()
  }
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
    [Parameter(Mandatory)][AllowEmptyCollection()][byte[]]$Body,
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

# ------------------------------------------------------------------ small helpers

function Get-UwNonce {
  [CmdletBinding()]
  [OutputType([string])]
  param()
  $bytes = New-Object byte[] 16
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  ConvertTo-UwBase64Url -Bytes $bytes
}

function Get-UwUuid {
  [CmdletBinding()]
  [OutputType([string])]
  param()
  [guid]::NewGuid().ToString()
}

function Read-UwJson {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Path,
    $Default = $null
  )
  if (-not (Test-Path -LiteralPath $Path)) { return $Default }
  try {
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    if ([string]::IsNullOrWhiteSpace($text)) { return $Default }
    return ($text | ConvertFrom-Json)
  } catch {
    return $Default
  }
}

# Write to a temporary file, then replace: a power cut never leaves half a file.
function Save-UwJson {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][AllowNull()]$Value
  )
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $tmp = "$Path.tmp"
  $json = ConvertTo-Json -InputObject $Value -Depth 10 -Compress
  [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

# Local wall-clock text of an instant (for the warning message), e.g. "22:40".
function Format-UwTime {
  [CmdletBinding()]
  [OutputType([string])]
  param([Parameter(Mandatory)][long]$Ms)
  [DateTimeOffset]::FromUnixTimeMilliseconds($Ms).ToLocalTime().ToString('HH:mm')
}

# ------------------------------------------------------------------ system access (mocked in tests)

function Assert-UwRealSystem {
  [CmdletBinding()]
  param([string]$Name)
  if (-not $script:UwRealSystem) {
    throw "Chamada real ao sistema fora do agente (teste sem mock?): $Name"
  }
}

function Get-UwUtcNow {
  [CmdletBinding()]
  [OutputType([long])]
  param()
  Assert-UwRealSystem 'Get-UwUtcNow'
  [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}

function Wait-UwSecond {
  [CmdletBinding()]
  param([int]$Seconds = 1)
  Assert-UwRealSystem 'Wait-UwSecond'
  Start-Sleep -Seconds $Seconds
}

function Get-UwBootTime {
  [CmdletBinding()]
  param()
  Assert-UwRealSystem 'Get-UwBootTime'
  try {
    $boot = (Get-CimInstance -ClassName Win32_OperatingSystem).LastBootUpTime
    return ([DateTimeOffset]$boot).ToUnixTimeMilliseconds()
  } catch {
    return $null
  }
}

# One HTTP request with the exact response bytes (signatures cover bytes, not decoded text).
function Invoke-UwHttp {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Url,
    [hashtable]$Headers = @{},
    [byte[]]$Body = $null,
    [int]$TimeoutMs = $script:UwHttpTimeoutMs
  )
  Assert-UwRealSystem 'Invoke-UwHttp'
  $req = [System.Net.HttpWebRequest]::Create($Url)
  $req.Method = $Method
  $req.Timeout = $TimeoutMs
  $req.ReadWriteTimeout = $TimeoutMs
  $req.KeepAlive = $false
  foreach ($k in $Headers.Keys) {
    if ($k -eq 'Content-Type') { $req.ContentType = $Headers[$k] } else { $req.Headers[$k] = $Headers[$k] }
  }
  if ($null -ne $Body) {
    $req.ContentLength = $Body.Length
    $stream = $req.GetRequestStream()
    try { $stream.Write($Body, 0, $Body.Length) } finally { $stream.Dispose() }
  }
  $resp = $null
  try {
    $resp = $req.GetResponse()
  } catch [System.Net.WebException] {
    if ($null -eq $_.Exception.Response) { throw }
    $resp = $_.Exception.Response
  }
  try {
    $ms = New-Object System.IO.MemoryStream
    $rs = $resp.GetResponseStream()
    try { $rs.CopyTo($ms) } finally { $rs.Dispose() }
    $out = @{}
    foreach ($k in $resp.Headers.AllKeys) { $out[$k.ToLowerInvariant()] = $resp.Headers[$k] }
    return @{ Status = [int]$resp.StatusCode; Body = $ms.ToArray(); Headers = $out }
  } finally {
    $resp.Dispose()
  }
}

# Whether someone is logged on and how many sessions (owner Q-6: never who). `quser` prints a header
# line and one line per session; its texts are localized, so only lines are counted.
function Get-UwSessionInfo {
  [CmdletBinding()]
  param()
  Assert-UwRealSystem 'Get-UwSessionInfo'
  try {
    $lines = @(& quser.exe 2>$null | Where-Object { $_ -match '\S' })
    $count = [Math]::Max(0, $lines.Count - 1)
    return @{ loggedOn = ($count -gt 0); sessions = $count }
  } catch {
    try {
      $user = (Get-CimInstance -ClassName Win32_ComputerSystem).UserName
      if ($user) { return @{ loggedOn = $true; sessions = 1 } }
      return @{ loggedOn = $false; sessions = 0 }
    } catch {
      return @{ loggedOn = $null; sessions = 0 }
    }
  }
}

# Freezing software (FR-308.1, ADR-047), reported in every check-in.
function Get-UwFreezeInfo {
  [CmdletBinding()]
  param()
  Assert-UwRealSystem 'Get-UwFreezeInfo'
  try {
    $services = @(Get-Service -Name 'DFServ', 'DfServEx' -ErrorAction SilentlyContinue | ForEach-Object Name)
    $processes = @(Get-Process -Name 'FrzState2k', 'DFServ', 'shield', 'shdserv', 'shdtray', 'DefenderDaemon' -ErrorAction SilentlyContinue | ForEach-Object ProcessName)
    $dfcExit = $null
    if ($services.Count -gt 0 -or $processes -contains 'FrzState2k') {
      # DFC.exe location is not documented for every version (ADR-047): PATH, then the usual folders.
      $candidates = @(Get-Command 'DFC.exe' -ErrorAction SilentlyContinue | ForEach-Object Source) +
        @("$env:WINDIR\SysWOW64\DFC.exe", "$env:WINDIR\System32\DFC.exe")
      $dfc = @($candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1)
      if ($dfc.Count -gt 0) {
        & $dfc[0] get /ISFROZEN | Out-Null
        $dfcExit = $LASTEXITCODE
      }
    }
    $uwf = $null
    try {
      $f = Get-CimInstance -Namespace 'root\standardcimv2\embedded' -ClassName 'UWF_Filter' -ErrorAction Stop | Select-Object -First 1
      if ($f) { $uwf = @{ CurrentEnabled = [bool]$f.CurrentEnabled; NextEnabled = [bool]$f.NextEnabled } }
    } catch {
      $uwf = $null # no UWF on this edition
    }
    return Resolve-UwFreezeState @{ Services = $services; Processes = $processes; DfcExit = $dfcExit; Uwf = $uwf; Failed = $false }
  } catch {
    return @{ product = $null; state = 'unverified' }
  }
}

<#
  Freezing software (FR-308.1, ADR-047), from facts gathered by Get-UwFreezeFact. Pure. Only what
  ADR-047 lists: Deep Freeze state from `DFC.exe get /ISFROZEN` (exit 0 thawed, 1 frozen; third-
  party sources), UWF from UWF_Filter.CurrentEnabled (Microsoft); Reboot Restore Rx and Shadow
  Defender are only detected (state "não verificado"). Returns @{ product; state } with state
  none | frozen | thawed | present_unknown | unverified.
#>
function Resolve-UwFreezeState {
  [CmdletBinding()]
  param($Facts)
  # StrictMode: a missing key throws, so read every fact through ContainsKey.
  $get = { param($k) if ($Facts -is [hashtable] -and $Facts.ContainsKey($k)) { $Facts[$k] } else { $null } }
  if ($null -eq $Facts -or (& $get 'Failed')) { return @{ product = $null; state = 'unverified' } }
  $dfcExit = & $get 'DfcExit'
  $uwf = & $get 'Uwf'
  $names = @(@(& $get 'Services') + @(& $get 'Processes') | Where-Object { $_ } | ForEach-Object { ([string]$_).ToLowerInvariant() })
  $found = New-Object System.Collections.ArrayList
  if ($names -contains 'dfserv' -or $names -contains 'dfservex' -or $names -contains 'frzstate2k') {
    $state = 'present_unknown'
    if ($dfcExit -eq 0) { $state = 'thawed' } elseif ($dfcExit -eq 1) { $state = 'frozen' }
    [void]$found.Add(@{ product = 'deep_freeze'; state = $state })
  }
  if ($null -ne $uwf) {
    $state = 'thawed'
    if ($uwf.CurrentEnabled) { $state = 'frozen' }
    [void]$found.Add(@{ product = 'uwf'; state = $state })
  }
  if ($names -contains 'shield' -or $names -contains 'shdserv' -or $names -contains 'shdtray') {
    [void]$found.Add(@{ product = 'reboot_restore_rx'; state = 'present_unknown' })
  }
  if ($names -contains 'defenderdaemon') {
    [void]$found.Add(@{ product = 'shadow_defender'; state = 'present_unknown' })
  }
  if ($found.Count -eq 0) { return @{ product = $null; state = 'none' } }
  # The most constraining one is what matters: frozen, then unknown, then thawed.
  foreach ($want in 'frozen', 'present_unknown', 'thawed') {
    foreach ($f in $found) { if ($f.state -eq $want) { return $f } }
  }
  return $found[0]
}


# Power plan facts read, never changed (owner Q-3); filled in by M18-T05.
function Get-UwPowerInfo {
  [CmdletBinding()]
  param()
  Assert-UwRealSystem 'Get-UwPowerInfo'
  $query = { param($setting) ConvertFrom-UwPowercfgOutput -Lines @(& powercfg.exe /QUERY SCHEME_CURRENT SUB_SLEEP $setting 2>$null) }
  return ConvertTo-UwPowerInfo -Sleep (& $query 'STANDBYIDLE') -Timers (& $query 'RTCWAKE')
}

<#
  AC and DC indexes from `powercfg /QUERY`. Labels are localized (pt-BR Windows prints Portuguese),
  so only the hex values are read: the last two are the current AC and DC indexes (ADR-045).
#>
function ConvertFrom-UwPowercfgOutput {
  [CmdletBinding()]
  param([AllowEmptyCollection()][string[]]$Lines)
  $hex = @($Lines | ForEach-Object { if ($_ -match ':\s*0x([0-9a-fA-F]+)\s*$') { [Convert]::ToInt64($Matches[1], 16) } })
  if ($hex.Count -lt 2) { return $null }
  return @{ Ac = $hex[$hex.Count - 2]; Dc = $hex[$hex.Count - 1] }
}

# What the check-in reports about the power plan (owner Q-3): sleep minutes on AC (0 = never).
function ConvertTo-UwPowerInfo {
  [CmdletBinding()]
  param($Sleep, $Timers)
  $minutes = $null
  if ($null -ne $Sleep) { $minutes = [int][Math]::Round($Sleep.Ac / 60) }
  $wake = 'unknown'
  if ($null -ne $Timers) {
    switch ([int]$Timers.Ac) {
      0 { $wake = 'disabled' }
      1 { $wake = 'enabled' }
      2 { $wake = 'important_only' }
    }
  }
  return @{ sleepAfterMinutes = $minutes; wakeTimers = $wake }
}

# Hibernation facts (FR-605.1): whether it is on and the AC "hibernate after" minutes (0 = never).
function Get-UwHibernateInfo {
  [CmdletBinding()]
  param()
  Assert-UwRealSystem 'Get-UwHibernateInfo'
  $props = $null
  try {
    $props = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Power' -ErrorAction Stop
  } catch { Write-Verbose "Power: $_" }
  $enabled = ConvertTo-UwHibernateEnabled -Enabled (Get-UwProp $props 'HibernateEnabled') -Default (Get-UwProp $props 'HibernateEnabledDefault')
  $idle = ConvertFrom-UwPowercfgOutput -Lines @(& powercfg.exe /QUERY SCHEME_CURRENT SUB_SLEEP HIBERNATEIDLE 2>$null)
  $minutes = $null
  if ($null -ne $idle) { $minutes = [int][Math]::Round($idle.Ac / 60) }
  @{ enabled = $enabled; afterMinutes = $minutes }
}

<#
  Field test 2026-10-17: Windows leaves HibernateEnabled unset until someone changes it; then the
  factory value HibernateEnabledDefault says whether hibernation is on. Neither: unknown.
#>
function ConvertTo-UwHibernateEnabled {
  [CmdletBinding()]
  param($Enabled = $null, $Default = $null)
  if ($null -ne $Enabled) { return ([int]$Enabled -eq 1) }
  if ($null -ne $Default) { return ([int]$Default -eq 1) }
  return $null
}

<#
  How the PC went away before it came back without restarting (FR-605.1): the newest Kernel-Power
  event 42 since then. TargetState 5 = hibernation, 2..4 = sleep (SYSTEM_POWER_STATE; não verificado
  on every model), anything else or no event: unknown.
#>
function Get-UwSleepKind {
  [CmdletBinding()]
  [OutputType([string])]
  param([Parameter(Mandatory)][long]$SinceMs)
  Assert-UwRealSystem 'Get-UwSleepKind'
  try {
    $since = [DateTimeOffset]::FromUnixTimeMilliseconds($SinceMs).LocalDateTime.AddMinutes(-1)
    $e = Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Kernel-Power'; Id = 42; StartTime = $since } -MaxEvents 1 -ErrorAction Stop
    $xml = [xml]$e.ToXml()
    $state = @($xml.Event.EventData.Data | Where-Object { $_.Name -eq 'TargetState' } | ForEach-Object { $_.'#text' }) | Select-Object -First 1
    return ConvertTo-UwSleepKind -TargetState $state
  } catch {
    return 'unknown'
  }
}

<#
  FR-605.1: back after a gap (no heartbeat for more than 3 minutes) without restarting (boot before
  the last heartbeat): the PC was suspended or hibernated in between. $null otherwise.
#>
function Get-UwResume {
  [CmdletBinding()]
  param($LastBeat, $Boot, [Parameter(Mandatory)][long]$Now)
  if ($null -eq $LastBeat -or $null -eq $Boot) { return $null }
  if ($Now - [long]$LastBeat -le $script:UwSleepGapMs -or [long]$Boot -ge [long]$LastBeat) { return $null }
  [ordered]@{ from = [long]$LastBeat; to = $Now; kind = (Get-UwSleepKind -SinceMs ([long]$LastBeat)) }
}

function ConvertTo-UwSleepKind {
  [CmdletBinding()]
  [OutputType([string])]
  param($TargetState)
  $s = [string]$TargetState
  if ($s -eq '5') { return 'hibernate' }
  if ($s -in @('2', '3', '4')) { return 'sleep' }
  return 'unknown'
}

# FR-605.3: AC sleep and hibernate timeouts (minutes, 0 = never) and hibernation on/off ($null: keep).
function Set-UwSleepTimeout {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param($StandbyMinutes = $null, $HibernateMinutes = $null, $Hibernation = $null)
  Assert-UwRealSystem 'Set-UwSleepTimeout'
  if (-not $PSCmdlet.ShouldProcess('Plano de energia', 'Mudar suspensão e hibernação')) { return }
  $calls = @()
  if ($null -ne $StandbyMinutes) { $calls += , @('/change', 'standby-timeout-ac', [string][int]$StandbyMinutes) }
  if ($null -ne $HibernateMinutes) { $calls += , @('/change', 'hibernate-timeout-ac', [string][int]$HibernateMinutes) }
  if ($null -ne $Hibernation) { $calls += , @('/hibernate', $(if ($Hibernation) { 'on' } else { 'off' })) }
  foreach ($a in $calls) {
    & powercfg.exe @a 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "powercfg $($a -join ' ') terminou com código $LASTEXITCODE" }
  }
}

<#
  FR-605.3 (ADR-061): "Impedir suspensão e hibernação". On: keep the current values once, then set
  AC sleep/hibernate to never and hibernation off — again whenever the machine undid it (freezing
  restores the power plan at restart). Off: put back what was kept. The outcome goes in the health.
#>
function Invoke-UwSleepPolicy {
  [CmdletBinding()]
  param([bool]$Prevent, [Parameter(Mandatory)][hashtable]$Health, [long]$Now, $Power = $null, $Hibernate = $null)
  $state = [string](Get-UwProp $Health.preventSleep 'state' '')
  $standby = Get-UwProp $Power 'sleepAfterMinutes'
  $hibMinutes = Get-UwProp $Hibernate 'afterMinutes'
  $hibOn = Get-UwProp $Hibernate 'enabled'
  if ($Prevent) {
    $done = $state -eq 'applied' -and $standby -eq 0 -and $hibOn -ne $true -and ($null -eq $hibMinutes -or $hibMinutes -eq 0)
    if ($done) { return }
    if ($null -eq $Health.sleepSaved) {
      $Health.sleepSaved = [ordered]@{ standby = $standby; hibernate = $hibMinutes; hibernateEnabled = $hibOn }
    }
    try {
      Set-UwSleepTimeout -StandbyMinutes 0 -HibernateMinutes 0 -Hibernation $false
      $Health.preventSleep = [ordered]@{ state = 'applied'; at = $Now; detail = $null }
    } catch {
      $Health.preventSleep = [ordered]@{ state = 'failed'; at = $Now; detail = ([string]$_).Substring(0, [Math]::Min(200, ([string]$_).Length)) }
    }
    return
  }
  if ($state -ne 'applied' -or $null -eq $Health.sleepSaved) { return }
  $saved = $Health.sleepSaved
  try {
    Set-UwSleepTimeout -StandbyMinutes (Get-UwProp $saved 'standby') -HibernateMinutes (Get-UwProp $saved 'hibernate') -Hibernation (Get-UwProp $saved 'hibernateEnabled')
    $Health.preventSleep = [ordered]@{ state = 'restored'; at = $Now; detail = $null }
    $Health.sleepSaved = $null
  } catch {
    $Health.preventSleep = [ordered]@{ state = 'failed'; at = $Now; detail = ([string]$_).Substring(0, [Math]::Min(200, ([string]$_).Length)) }
  }
}

function Invoke-UwShutdown {
  [CmdletBinding()]
  [OutputType([int])]
  param([Parameter(Mandatory)][string[]]$Arguments)
  Assert-UwRealSystem 'Invoke-UwShutdown'
  $exe = Join-Path $env:SystemRoot 'System32\shutdown.exe'
  & $exe @Arguments | Out-Null
  return $LASTEXITCODE
}

# Rewrites "UniWake Despertar": one-time triggers that wake the PC before each item (ADR-045).
function Register-UwWakeTask {
  [CmdletBinding()]
  param([Parameter(Mandatory)][AllowEmptyCollection()][long[]]$AtMs)
  Assert-UwRealSystem 'Register-UwWakeTask'
  $script = Join-Path $script:UwAgentDir 'uniwake-agent.ps1'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`" -Wake"
  $triggers = @($AtMs | ForEach-Object {
      New-ScheduledTaskTrigger -Once -At ([DateTimeOffset]::FromUnixTimeMilliseconds($_).LocalDateTime)
    })
  if ($triggers.Count -eq 0) {
    # A task needs a trigger: an instant far away keeps it registered but idle.
    $triggers = @(New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddYears(5)))
  }
  $settings = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  $principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -RunLevel Highest
  Register-ScheduledTask -TaskName 'UniWake Despertar' -Action $action -Trigger $triggers `
    -Settings $settings -Principal $principal -Force | Out-Null
}

function Start-UwWarningTask {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param()
  Assert-UwRealSystem 'Start-UwWarningTask'
  if ($PSCmdlet.ShouldProcess('UniWake Aviso', 'Start-ScheduledTask')) {
    Start-ScheduledTask -TaskName 'UniWake Aviso'
  }
}

# The agent folder must still be owned by Administrators/SYSTEM with no write access for users
# (ADR-042): otherwise someone could have replaced what SYSTEM runs.
function Test-UwAgentFolder {
  [CmdletBinding()]
  [OutputType([bool])]
  param([string]$Path = $script:UwAgentDir)
  Assert-UwRealSystem 'Test-UwAgentFolder'
  try {
    $acl = Get-Acl -LiteralPath $Path
    $owner = (New-Object System.Security.Principal.NTAccount($acl.Owner)).Translate(
      [System.Security.Principal.SecurityIdentifier]).Value
    if ($owner -notin @('S-1-5-32-544', 'S-1-5-18')) { return $false }
    $writers = 'Write|Modify|FullControl|CreateFiles|AppendData|ChangePermissions|TakeOwnership'
    foreach ($ace in $acl.Access) {
      if ($ace.AccessControlType -ne 'Allow') { continue }
      $sid = $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
      if ($sid -in @('S-1-5-32-544', 'S-1-5-18')) { continue }
      if ([string]$ace.FileSystemRights -match $writers) { return $false }
    }
    return $true
  } catch {
    return $false
  }
}

# ------------------------------------------------------------------ local data (ADR-045)

function Get-UwPathSet {
  [CmdletBinding()]
  param()
  $config = Read-UwJson (Join-Path $script:UwAgentDir 'config.json') $null
  $data = $script:UwDataDir
  if (-not $script:UwIgnorePersistent -and $config -and
    ($config.PSObject.Properties.Name -contains 'persistentPath') -and $config.persistentPath) {
    $data = [string]$config.persistentPath
  }
  return @{
    Config    = Join-Path $script:UwAgentDir 'config.json'
    Token     = Join-Path $script:UwAgentDir 'token.txt'
    Agenda    = Join-Path $data 'agenda.json'
    State     = Join-Path $data 'state.json'
    Reports   = Join-Path $data 'reports.json'
    Heartbeat = Join-Path $data 'heartbeat.json'
    Health    = Join-Path $data 'health.json'
  }
}

function Get-UwProp {
  [CmdletBinding()]
  param($Object, [string]$Name, $Default = $null)
  if ($null -eq $Object) { return $Default }
  # Hashtables and [ordered] dictionaries (built by the agent itself) as well as JSON objects.
  if ($Object -is [System.Collections.IDictionary]) {
    if ($Object.Contains($Name)) { return $Object[$Name] }
    return $Default
  }
  if ($Object.PSObject.Properties.Name -contains $Name) { return $Object.$Name }
  return $Default
}

# The agent's memory: clock offset, ids already handled (48 h), orders to run, receipts to send.
function Read-UwState {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path)
  $raw = Read-UwJson $Path $null
  $done = @{}
  $doneRaw = Get-UwProp $raw 'doneIds'
  if ($doneRaw) { foreach ($p in $doneRaw.PSObject.Properties) { $done[$p.Name] = [long]$p.Value } }
  return @{
    offsetMs      = [long](Get-UwProp $raw 'offsetMs' 0)
    doneIds       = $done
    agendaVersion = [string](Get-UwProp $raw 'agendaVersion' '')
    orders        = [System.Collections.ArrayList]@(Get-UwProp $raw 'orders' @())
    acked         = [System.Collections.ArrayList]@(Get-UwProp $raw 'acked' @())
  }
}

function Save-UwState {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][hashtable]$State, [long]$Now)
  # Handled ids are kept 48 h: long enough for any item of the window to have passed.
  $keep = [ordered]@{}
  foreach ($k in $State.doneIds.Keys) {
    if ($Now - $State.doneIds[$k] -lt 48L * 3600000) { $keep[$k] = $State.doneIds[$k] }
  }
  Save-UwJson $Path ([ordered]@{
      offsetMs      = $State.offsetMs
      doneIds       = $keep
      agendaVersion = $State.agendaVersion
      orders        = @($State.orders)
      acked         = @($State.acked)
    })
}

<#
  What the agent keeps for its health report (FR-603/604, ADR-059): the features each hub announced
  (by key id), the last self-update outcome and what it last sent about the antivirus.
#>
function Read-UwHealthState {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path)
  $raw = Read-UwJson $Path $null
  $features = @{}
  $f = Get-UwProp $raw 'hubFeatures'
  if ($f) {
    foreach ($p in $f.PSObject.Properties) { $features[$p.Name] = @(@($p.Value) | ForEach-Object { [string]$_ }) }
  }
  return @{
    hubFeatures = $features
    update      = Get-UwProp $raw 'update'
    av          = Get-UwProp $raw 'av'
    avHash      = [string](Get-UwProp $raw 'avHash' '')
    avPendingHash = [string](Get-UwProp $raw 'avPendingHash' '')
    avSentAt    = [long](Get-UwProp $raw 'avSentAt' 0)
    avCheckedAt = [long](Get-UwProp $raw 'avCheckedAt' 0)
    installTriedAt = [long](Get-UwProp $raw 'installTriedAt' 0)
    lastResume     = Get-UwProp $raw 'lastResume'
    preventSleep   = Get-UwProp $raw 'preventSleep'
    sleepSaved     = Get-UwProp $raw 'sleepSaved'
  }
}

function Save-UwHealthState {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][hashtable]$Health)
  $features = [ordered]@{}
  foreach ($k in $Health.hubFeatures.Keys) { $features[$k] = @($Health.hubFeatures[$k]) }
  Save-UwJson $Path ([ordered]@{
      hubFeatures = $features
      update      = $Health.update
      av          = $Health.av
      avHash      = $Health.avHash
      avPendingHash = $Health.avPendingHash
      avSentAt    = $Health.avSentAt
      avCheckedAt = $Health.avCheckedAt
      installTriedAt = $Health.installTriedAt
      lastResume     = $Health.lastResume
      preventSleep   = $Health.preventSleep
      sleepSaved     = $Health.sleepSaved
    })
}

# The `health` part of the check-in (FR-603, FR-604); Invoke-UwCheckin sends it only to hubs that announce it.
function Get-UwHealthReport {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][hashtable]$Health,
    $Config,
    [AllowEmptyCollection()][object[]]$Repairs = @(),
    $Antivirus = $null,
    $Hibernate = $null
  )
  $power = $null
  if ($null -ne $Hibernate) {
    $power = [ordered]@{
      hibernateEnabled      = $Hibernate.enabled
      hibernateAfterMinutes = $Hibernate.afterMinutes
      lastResume            = $Health.lastResume
      preventSleep          = $Health.preventSleep
    }
  }
  [ordered]@{
    installLevel = [int](Get-UwProp $Config 'installLevel' 1)
    update       = $Health.update
    repairs      = @($Repairs | Select-Object -Last 10)
    antivirus    = $Antivirus
    power        = $power
  }
}

function Read-UwReportQueue {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path)
  # Items go down the pipeline: callers wrap with @() (a returned list would nest inside it).
  foreach ($r in @(Read-UwJson $Path @())) { if ($null -ne $r) { $r } }
}

# Queues a report; past 500 the oldest are dropped (the hub has missed them anyway).
function Add-UwReport {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)]$Report)
  $queue = New-Object System.Collections.ArrayList
  foreach ($r in @(Read-UwReportQueue $Path)) { [void]$queue.Add($r) }
  [void]$queue.Add($Report)
  while ($queue.Count -gt $script:UwMaxQueuedReports) { $queue.RemoveAt(0) }
  Save-UwJson $Path @($queue)
}

# A report exactly as the hub's strict contract names it (no user names, owner Q-6).
function Format-UwReport {
  [CmdletBinding()]
  param(
    [string]$Occurrence = $null,
    [string]$Order = $null,
    [Parameter(Mandatory)][ValidateSet('shutdown', 'restart')][string]$Action,
    [Parameter(Mandatory)][ValidateSet('done', 'cancelled', 'skipped', 'failed')][string]$Outcome,
    [string]$Reason = $null,
    $PlannedAt = $null,
    $ExecutedAt = $null,
    [int]$Postpones = 0,
    [hashtable]$Session = @{ loggedOn = $null; sessions = $null },
    [bool]$WasAsleep = $false,
    $LateMinutes = $null,
    [bool]$NativeWarning = $false,
    [string]$FreezeState = 'unverified',
    [string]$Detail = $null
  )
  [ordered]@{
    uuid          = Get-UwUuid
    occurrence    = if ($Occurrence) { $Occurrence } else { $null }
    order         = if ($Order) { $Order } else { $null }
    action        = $Action
    outcome       = $Outcome
    reason        = if ($Reason) { $Reason } else { $null }
    plannedAt     = $PlannedAt
    executedAt    = $ExecutedAt
    postpones     = $Postpones
    userLoggedOn  = $Session.loggedOn
    sessions      = $Session.sessions
    wasAsleep     = $WasAsleep
    lateMinutes   = $LateMinutes
    nativeWarning = $NativeWarning
    freezeState   = $FreezeState
    detail        = if ($Detail) { $Detail.Substring(0, [Math]::Min(500, $Detail.Length)) } else { $null }
  }
}

# ------------------------------------------------------------------ check-in (FR-302, ADR-043/044)

function Format-UwCheckinRequest {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Nonce,
    [Parameter(Mandatory)][long]$Clock,
    $BootTime,
    [Parameter(Mandatory)][hashtable]$Freeze,
    [Parameter(Mandatory)][hashtable]$Power,
    [Parameter(Mandatory)][hashtable]$Session,
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Reports,
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$AckedOrders,
    # v1.6.0 (ADR-059): only for a hub that announced `health`; the key is left out otherwise.
    $Health = $null
  )
  $request = [ordered]@{
    protocol     = $script:UwProtocol
    nonce        = $Nonce
    agentVersion = $script:UwAgentVersion
    bootTime     = $BootTime
    clock        = $Clock
    freeze       = [ordered]@{ product = $Freeze.product; state = $Freeze.state; persistent = [bool]$Freeze.persistent }
    power        = [ordered]@{ sleepAfterMinutes = $Power.sleepAfterMinutes; wakeTimers = $Power.wakeTimers }
    session      = [ordered]@{ loggedOn = $Session.loggedOn; sessions = [int]$Session.sessions }
    reports      = @($Reports | Select-Object -First $script:UwMaxReportsPerCheckin)
    ackedOrders  = @($AckedOrders | Select-Object -First $script:UwMaxReportsPerCheckin)
  }
  if ($null -ne $Health) { $request['health'] = $Health }
  $request
}

# Keys this PC trusts: the ones in its hub list (the first came pinned by -HubKeyId).
function Get-UwTrustedKey {
  [CmdletBinding()]
  param([Parameter(Mandatory)]$Config, [Parameter(Mandatory)][string]$KeyId)
  foreach ($h in @(Get-UwProp $Config 'hubs' @())) {
    if ($h.keyId -eq $KeyId -and (Get-UwKeyId -N $h.publicKey.n -E $h.publicKey.e) -eq $KeyId) {
      return $h.publicKey
    }
  }
  return $null
}

<#
  Tries each hub in the list (FR-302.1, ADR-048) and returns the first answer whose signature
  verifies with a trusted key over this request's nonce: @{ Answer; Hub; SentAt; ReceivedAt }.
  @{ Unauthorized = $true } when a hub refused the token; $null when no hub answered.
#>
function Invoke-UwCheckin {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]$Config,
    [Parameter(Mandatory)][string]$Token,
    # Everything of the request but the nonce and the clock (Format-UwCheckinRequest parameters).
    [Parameter(Mandatory)][hashtable]$Request,
    # v1.6.0 (ADR-059): the health report and, per hub key id, the features that hub announced.
    $Health = $null,
    [hashtable]$Features = @{}
  )
  $unauthorized = $false
  $attempts = 0
  foreach ($hub in @(Get-UwProp $Config 'hubs' @())) {
    foreach ($url in @($hub.urls)) {
      if ($attempts -ge $script:UwMaxHubAttempts) { break }
      $attempts++
      $nonce = Get-UwNonce
      $sentAt = Get-UwUtcNow
      # A v1.5.0 hub refuses unknown fields: health only goes to hubs that announced it.
      $h = $null
      if ($null -ne $Health -and @($Features[[string]$hub.keyId]) -contains 'health') { $h = $Health }
      $body = [System.Text.Encoding]::UTF8.GetBytes(
        (ConvertTo-Json -InputObject (Format-UwCheckinRequest -Nonce $nonce -Clock $sentAt -Health $h @Request) -Depth 10 -Compress))
      try {
        $r = Invoke-UwHttp -Method 'POST' -Url "$url/agent/v1/checkin" -Body $body -Headers @{
          'Authorization' = "Bearer $Token"
          'Content-Type'  = 'application/json; charset=utf-8'
        }
      } catch {
        continue # hub off or unreachable: next one
      }
      if ($r.Status -eq 401) { $unauthorized = $true; continue }
      if ($r.Status -ne 200) { continue }
      $keyId = [string]$r.Headers['x-uniwake-key']
      $key = Get-UwTrustedKey -Config $Config -KeyId $keyId
      if ($null -eq $key) { continue }
      $sig = [string]$r.Headers['x-uniwake-signature']
      if (-not $sig -or -not (Test-UwSignature -Body $r.Body -Nonce $nonce -Signature $sig -N $key.n -E $key.e)) {
        continue # forged or replayed: ignore everything in it
      }
      try {
        $answer = [System.Text.Encoding]::UTF8.GetString($r.Body) | ConvertFrom-Json
      } catch {
        continue
      }
      if ((Get-UwProp $answer 'protocol') -ne $script:UwProtocol) { continue }
      return @{
        Answer = $answer; Hub = $hub; Url = $url; SentAt = $sentAt; ReceivedAt = (Get-UwUtcNow)
        Features = @(@(Get-UwProp $answer 'features' @()) | ForEach-Object { [string]$_ }); SentHealth = ($null -ne $h)
      }
    }
  }
  if ($unauthorized) { return @{ Unauthorized = $true } }
  return $null
}

<#
  The new hub list (ADR-044/048): accepted only with an epoch not older than ours; the hub that
  answered stays in it (a hub without a known address of its own does not list itself).
#>
function Merge-UwHubList {
  [CmdletBinding()]
  param([Parameter(Mandatory)]$Config, [Parameter(Mandatory)]$Used, [Parameter(Mandatory)]$Hubs)
  $epoch = [int](Get-UwProp $Config 'epoch' 0)
  if ([int]$Hubs.epoch -lt $epoch) { return $Config }
  $list = New-Object System.Collections.ArrayList
  foreach ($h in @($Hubs.list)) { [void]$list.Add($h) }
  if (-not (@($list) | Where-Object { $_.keyId -eq $Used.keyId })) { [void]$list.Insert(0, $Used) }
  # The hub that answered goes first next time.
  $ordered = @($list | Where-Object { $_.keyId -eq $Used.keyId }) + @($list | Where-Object { $_.keyId -ne $Used.keyId })
  $out = [ordered]@{}
  foreach ($p in $Config.PSObject.Properties) { $out[$p.Name] = $p.Value }
  $out['hubs'] = @($ordered)
  $out['epoch'] = [int]$Hubs.epoch
  return [pscustomobject]$out
}

<#
  Applies a verified answer (FR-302..304): clock offset, acknowledged reports, orders and cancels,
  agenda (and the wake task when it changed), new token, hub list. Returns the reports to queue
  (cancelled orders).
#>
function Invoke-UwAnswer {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][hashtable]$Result,
    [Parameter(Mandatory)][hashtable]$State,
    [Parameter(Mandatory)][hashtable]$Paths,
    [Parameter(Mandatory)]$Config,
    [string[]]$SentAcks = @()
  )
  $a = $Result.Answer
  $mid = [long](($Result.SentAt + $Result.ReceivedAt) / 2)
  $State.offsetMs = [long]$a.serverTime - $mid
  $serverNow = [long]$a.serverTime
  $out = New-Object System.Collections.ArrayList

  # Reports the hub stored leave the queue.
  $acked = @($a.ackReports)
  if ($acked.Count -gt 0) {
    $queue = @(Read-UwReportQueue $Paths.Reports)
    $left = @($queue | Where-Object { $acked -notcontains $_.uuid })
    Save-UwJson $Paths.Reports @($left)
  }
  # Receipts sent in this check-in are done.
  foreach ($u in $SentAcks) { [void]$State.acked.Remove($u) }

  foreach ($o in @($a.orders)) {
    if ($o.action -eq 'cancel') {
      $pending = @($State.orders | Where-Object { $_.uuid -eq $o.cancels })
      foreach ($p in $pending) {
        [void]$State.orders.Remove($p)
        $State.doneIds[[string]$o.cancels] = $serverNow
        [void]$out.Add((Format-UwReport -Order $o.cancels -Action $p.action -Outcome 'cancelled' -Detail 'cancelado no painel'))
      }
      $State.doneIds[[string]$o.uuid] = $serverNow
      continue
    }
    if ($State.doneIds.ContainsKey([string]$o.uuid)) { continue } # delivered twice (two hubs)
    # ADR-053: the hub's order for a schedule occurrence this PC already ran from its agenda. Settle it
    # (reason already_done), never run the same run id twice.
    $occ = [string](Get-UwProp $o 'occurrence' '')
    if ($occ -and $State.doneIds.ContainsKey($occ)) {
      $State.doneIds[[string]$o.uuid] = $serverNow
      [void]$out.Add((Format-UwReport -Occurrence $occ -Order $o.uuid -Action $o.action -Outcome 'skipped' `
          -Reason 'already_done' -Detail 'já executado pela agenda'))
      if ($State.acked -notcontains $o.uuid) { [void]$State.acked.Add([string]$o.uuid) }
      continue
    }
    if (-not (@($State.orders) | Where-Object { $_.uuid -eq $o.uuid })) { [void]$State.orders.Add($o) }
    if ($State.acked -notcontains $o.uuid) { [void]$State.acked.Add([string]$o.uuid) }
  }

  if ([string]$a.agenda.version -ne $State.agendaVersion) {
    Save-UwJson $Paths.Agenda $a.agenda
    $State.agendaVersion = [string]$a.agenda.version
    $wake = @(@($a.agenda.items) | ForEach-Object {
        [long]$_.at - [long]$_.warningMinutes * $script:UwMinute - $script:UwMinute - $State.offsetMs
      } | Where-Object { $_ -gt $serverNow - $State.offsetMs } | Select-Object -First 30)
    Register-UwWakeTask -AtMs ([long[]]$wake)
  }

  $newToken = Get-UwProp $a 'newToken'
  if ($newToken) { [System.IO.File]::WriteAllText($Paths.Token, [string]$newToken) }

  $merged = Merge-UwHubList -Config $Config -Used $Result.Hub -Hubs $a.hubs
  Save-UwJson $Paths.Config $merged
  return , $out
}

# ------------------------------------------------------------------ agenda rules (ADR-045)

<#
  What to do now with the agenda, in order (ADR-045): items already handled or outside the window
  are ignored; booted after T → never run ("máquina estava desligada"); slept through the warning
  and woke late → run only if at most 60 min late and before the next wake, else skip; otherwise
  run once the warning time has come. Returns @{ Kind = 'run'|'skip'; Item; Reason; LateMinutes;
  WasAsleep } or $null.
#>
function Get-UwDueItem {
  [CmdletBinding()]
  param(
    $Agenda,
    [Parameter(Mandatory)][hashtable]$State,
    [Parameter(Mandatory)][long]$Now,
    $BootTime,
    $LastHeartbeat
  )
  if ($null -eq $Agenda) { return $null }
  $from = [long]$Agenda.window.from
  $to = [long]$Agenda.window.to
  $wakes = @(@($Agenda.nextWakes) | ForEach-Object { [long]$_ })
  foreach ($item in @(@($Agenda.items) | Sort-Object { [long]$_.at })) {
    $at = [long]$item.at
    if ($State.doneIds.ContainsKey([string]$item.occurrence)) { continue }
    if ($at -lt $from -or $at -gt $to) { continue }
    $warnStart = $at - [long]$item.warningMinutes * $script:UwMinute
    if ($Now -lt $warnStart) { return $null } # the next one is not due yet
    if ($null -ne $BootTime -and [long]$BootTime -gt $at) {
      return @{ Kind = 'skip'; Item = $item; Reason = 'was_off'; LateMinutes = $null; WasAsleep = $false }
    }
    $asleep = $null -ne $LastHeartbeat -and [long]$LastHeartbeat -lt $warnStart -and
      ($Now - [long]$LastHeartbeat) -gt $script:UwSleepGapMs
    if ($Now -gt $at + $script:UwMinute) {
      $late = [int][Math]::Floor(($Now - $at) / $script:UwMinute)
      $nextWake = @($wakes | Where-Object { $_ -gt $at } | Sort-Object | Select-Object -First 1)
      $beforeWake = $nextWake.Count -eq 0 -or $Now -lt $nextWake[0]
      if ($late -le $script:UwLateWakeMaxMinutes -and $beforeWake) {
        return @{ Kind = 'run'; Item = $item; Reason = $null; LateMinutes = $late; WasAsleep = $asleep }
      }
      return @{ Kind = 'skip'; Item = $item; Reason = 'late_wake'; LateMinutes = $late; WasAsleep = $asleep }
    }
    return @{ Kind = 'run'; Item = $item; Reason = $null; LateMinutes = $null; WasAsleep = $asleep }
  }
  return $null
}

# ------------------------------------------------------------------ warning and shutdown (FR-304, ADR-046)

function Get-UwUiPathSet {
  [CmdletBinding()]
  param()
  @{
    Request  = Join-Path $script:UwUiDir 'request\request.json'
    Response = Join-Path $script:UwUiDir 'response'
  }
}

# The warning text (FR-304.1a): the shutdown time, plus the postpone suffix while postpones remain.
function Format-UwWarning {
  [CmdletBinding()]
  [OutputType([string])]
  param(
    [Parameter(Mandatory)]$Messages,
    [Parameter(Mandatory)][string]$Time,
    [int]$PostponesLeft = 0
  )
  $text = ([string]$Messages.warning).Replace('{hora}', $Time)
  if ($PostponesLeft -gt 0) { $text += ' ' + ([string]$Messages.postpone).Replace('{n}', [string]$PostponesLeft) }
  return $text
}

# `shutdown /c` takes at most 512 characters, and never the postpone suffix.
function Get-UwShutdownComment {
  [CmdletBinding()]
  [OutputType([string])]
  param([Parameter(Mandatory)]$Messages, [Parameter(Mandatory)][string]$Time)
  $text = Format-UwWarning -Messages $Messages -Time $Time
  return $text.Substring(0, [Math]::Min(512, $text.Length))
}

<#
  Responses the user's window wrote for this request (ADR-046). SYSTEM only reads here: it never
  writes or deletes in this user-writable folder, skips links (reparse points) and files over
  4 KB, and accepts only the current request id. Each response id counts once.
#>
function Read-UwUiResponse {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Folder,
    [Parameter(Mandatory)][string]$RequestId,
    [Parameter(Mandatory)][hashtable]$Seen
  )
  $out = New-Object System.Collections.ArrayList
  if (-not (Test-Path -LiteralPath $Folder)) { return , $out }
  # At most the 50 newest files: a flood of files in the users' folder cannot stall the warning.
  $files = @(Get-ChildItem -LiteralPath $Folder -File -Force -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 50)
  foreach ($f in $files) {
    if ($f.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { continue }
    if ($f.Length -gt 4096) { continue }
    try {
      $r = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    } catch {
      continue
    }
    if ([string](Get-UwProp $r 'requestId') -ne $RequestId) { continue }
    $id = [string](Get-UwProp $r 'responseId')
    if (-not $id -or $Seen.ContainsKey($id)) { continue }
    $Seen[$id] = $true
    [void]$out.Add($r)
  }
  return , $out
}

# The request file lives in a SYSTEM-only folder (users read it): writing and deleting there is safe.
function Write-UwUiRequest {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path, [AllowNull()]$Request)
  if ($null -eq $Request) {
    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }
    return
  }
  Save-UwJson $Path $Request
}

<#
  Asks Windows to keep the computer awake (on) or lets it sleep again (off). Field test 2026-10-18:
  a PC woken from hibernation by "UniWake Despertar" with nobody at it went back to sleep after
  about 2 minutes (unattended wake), in the middle of the warning, before shutting down.
#>
function Set-UwKeepAwake {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([bool]$On)
  Assert-UwRealSystem 'Set-UwKeepAwake'
  if (-not $PSCmdlet.ShouldProcess('Windows', 'Manter o computador acordado')) { return }
  if (-not ('UniWake.Power' -as [type])) {
    Add-Type -Namespace UniWake -Name Power -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
  }
  # ES_CONTINUOUS (+ ES_SYSTEM_REQUIRED while on).
  $flags = [uint32]2147483648
  if ($On) { $flags = [uint32]2147483649 }
  [void][UniWake.Power]::SetThreadExecutionState($flags)
}

<#
  Runs one shutdown/restart (an agenda item or an order): the warning (window with "Adiar" when a
  user is logged on, the native warning as the fallback), cancel checks, then shutdown.exe. Returns
  the report, or $null when the job was cancelled through a check-in (that path already reported).
  -Poll is a check-in; cancels arrive through $State.doneIds. The computer is kept awake meanwhile.
#>
function Invoke-UwExecution {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][hashtable]$Job,
    [Parameter(Mandatory)][hashtable]$State,
    [Parameter(Mandatory)]$Messages,
    [Parameter(Mandatory)][scriptblock]$Poll,
    [Parameter(Mandatory)][hashtable]$Freeze
  )
  try { Set-UwKeepAwake -On $true } catch { Write-Verbose "manter acordado: $_" }
  try {
    return Invoke-UwExecutionStep @PSBoundParameters
  } finally {
    try { Set-UwKeepAwake -On $false } catch { Write-Verbose "manter acordado: $_" }
  }
}

function Invoke-UwExecutionStep {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][hashtable]$Job,
    [Parameter(Mandatory)][hashtable]$State,
    [Parameter(Mandatory)]$Messages,
    [Parameter(Mandatory)][scriptblock]$Poll,
    [Parameter(Mandatory)][hashtable]$Freeze
  )
  $policy = $Job.Policy
  $postponesLeft = 0
  if ($policy.allowPostpone) { $postponesLeft = [int]$policy.postponeMax }
  $postpones = 0
  $T = [long]$Job.At
  $session = Get-UwSessionInfo
  $ui = Get-UwUiPathSet
  $requestId = Get-UwUuid
  $seen = @{}
  $native = $false
  $window = $false
  $flag = '/s'
  if ($Job.Action -eq 'restart') { $flag = '/r' }
  $report = @{
    Occurrence = $Job.Occurrence; Order = $Job.Order; Action = $Job.Action; PlannedAt = $Job.PlannedAt
    Session = $session; WasAsleep = [bool]$Job.WasAsleep; LateMinutes = $Job.LateMinutes; FreezeState = $Freeze.state
  }

  if ($session.loggedOn) {
    Write-UwUiRequest -Path $ui.Request -Request (Format-UwUiRequest -RequestId $requestId -Job $Job -T $T `
        -PostponesLeft $postponesLeft -State $State -Messages $Messages)
    try { Start-UwWarningTask } catch { Write-Verbose "warning task: $_" }
    # The window proves it is up with an "alive" response within 20 s; otherwise the native warning.
    for ($i = 0; $i -lt 20 -and -not $window; $i++) {
      foreach ($r in (Read-UwUiResponse -Folder $ui.Response -RequestId $requestId -Seen $seen)) {
        if ($r.kind -eq 'alive') { $window = $true }
      }
      if (-not $window) { Wait-UwSecond 1 }
    }
    if (-not $window) {
      $left = ($T - ((Get-UwUtcNow) + $State.offsetMs)) / 1000
      $seconds = [int][Math]::Max(30, [Math]::Min(600, $left))
      $comment = Get-UwShutdownComment -Messages $Messages -Time (Format-UwTime ($T - $State.offsetMs))
      $code = Invoke-UwShutdown -Arguments @($flag, '/t', [string]$seconds, '/c', $comment)
      Write-UwUiRequest -Path $ui.Request -Request $null
      if ($code -ne 0) {
        return Format-UwReport @report -Outcome 'failed' -Reason 'error' -NativeWarning $true `
          -Detail "shutdown.exe saiu com código $code"
      }
      $native = $true
      $T = (Get-UwUtcNow) + $State.offsetMs + $seconds * 1000L
    }
  }

  $lastPoll = (Get-UwUtcNow) + $State.offsetMs
  while ($true) {
    $now = (Get-UwUtcNow) + $State.offsetMs
    if ($null -ne $Job.Order -and $State.doneIds.ContainsKey([string]$Job.Order)) {
      # Cancelled in the panel (FR-304.4): stop a native countdown; the check-in reported it.
      if ($native) { [void](Invoke-UwShutdown -Arguments @('/a')) }
      Write-UwUiRequest -Path $ui.Request -Request $null
      return $null
    }
    if ($window) {
      foreach ($r in (Read-UwUiResponse -Folder $ui.Response -RequestId $requestId -Seen $seen)) {
        # Limits are enforced here, not by the window: a tampered file changes nothing (AC-304-05).
        if ($r.kind -eq 'postpone' -and $postponesLeft -gt 0) {
          $postponesLeft--
          $postpones++
          $T += [long]$policy.postponeMinutes * $script:UwMinute
          Write-UwUiRequest -Path $ui.Request -Request (Format-UwUiRequest -RequestId $requestId -Job $Job -T $T `
              -PostponesLeft $postponesLeft -State $State -Messages $Messages)
        }
      }
    }
    if ($native) {
      if ($now -ge $T) { break } # Windows is shutting down by itself
    } elseif ($now -ge $T - 30000) {
      break
    }
    if ($now - $lastPoll -ge 30000) {
      try { [void](& $Poll) } catch { Write-Verbose "poll: $_" }
      $lastPoll = (Get-UwUtcNow) + $State.offsetMs
    }
    Wait-UwSecond 2
  }

  Write-UwUiRequest -Path $ui.Request -Request $null
  if ($native) {
    return Format-UwReport @report -Outcome 'done' -ExecutedAt ((Get-UwUtcNow) + $State.offsetMs) `
      -Postpones $postpones -NativeWarning $true
  }
  $comment = Get-UwShutdownComment -Messages $Messages -Time (Format-UwTime ($T - $State.offsetMs))
  $code = Invoke-UwShutdown -Arguments @($flag, '/t', '30', '/c', $comment)
  if ($code -ne 0) {
    return Format-UwReport @report -Outcome 'failed' -Reason 'error' -Postpones $postpones `
      -Detail "shutdown.exe saiu com código $code"
  }
  return Format-UwReport @report -Outcome 'done' -ExecutedAt ((Get-UwUtcNow) + $State.offsetMs) -Postpones $postpones
}

function Format-UwUiRequest {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$RequestId,
    [Parameter(Mandatory)][hashtable]$Job,
    [Parameter(Mandatory)][long]$T,
    [Parameter(Mandatory)][int]$PostponesLeft,
    [Parameter(Mandatory)][hashtable]$State,
    [Parameter(Mandatory)]$Messages
  )
  [ordered]@{
    requestId       = $RequestId
    action          = $Job.Action
    at              = $T - $State.offsetMs
    postponesLeft   = $PostponesLeft
    postponeMinutes = [int]$Job.Policy.postponeMinutes
    message         = Format-UwWarning -Messages $Messages -Time (Format-UwTime ($T - $State.offsetMs)) -PostponesLeft $PostponesLeft
  }
}

# ------------------------------------------------------------------ self-update (ADR-044)

<#
  Replaces an agent script whose SHA-256 differs from the one in the signed answer, after checking
  the downloaded bytes against it (write temp, verify, move). A mismatch changes nothing. v1.6.0
  (FR-603.2): the written file is read back a moment later, and every attempt has an outcome that
  goes in `$Health.update` for the hub — "the antivirus removed it" is no longer silent.
#>
function Sync-UwScript {
  [CmdletBinding()]
  param([Parameter(Mandatory)]$Scripts, [Parameter(Mandatory)][string]$HubUrl, [hashtable]$Health = $null)
  $last = $null
  $all = $true
  foreach ($name in 'uniwake-agent.ps1', 'uniwake-aviso.ps1') {
    $want = [string](Get-UwProp (Get-UwProp $Scripts $name) 'sha256' '')
    if (-not $want) { continue }
    $path = Join-Path $script:UwAgentDir $name
    if ((Get-UwFileSha256 -Path $path) -eq $want) { continue }
    $last = Sync-UwScriptFile -Name $name -Path $path -Want $want -HubUrl $HubUrl
    if ($last.outcome -ne 'updated') { $all = $false }
    if ($null -ne $Health) { $Health.update = $last }
  }
  # M29-R: every file matches the signed hashes again (restored by "UniWake Reparo", or the
  # antivirus was fixed): a past failure is over, so the panel stops showing the agent as blocked.
  if ($all -and $null -eq $last -and $null -ne $Health -and $null -ne $Health.update -and
    [string](Get-UwProp $Health.update 'outcome') -ne 'updated') {
    $Health.update = Format-UwUpdateOutcome 'updated' ([string](Get-UwProp $Health.update 'file')) $null 'conferido: igual ao do UniWake'
  }
  return $last
}

# SHA-256 of a file, '' when it does not exist or cannot be read.
function Get-UwFileSha256 {
  [CmdletBinding()]
  [OutputType([string])]
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  try { return Get-UwSha256Hex -Bytes ([System.IO.File]::ReadAllBytes($Path)) } catch { return '' }
}

function Format-UwUpdateOutcome {
  [CmdletBinding()]
  param([string]$Outcome, [string]$Name, $Code = $null, [string]$Detail = '')
  $d = $null
  if ($Detail) { $d = $Detail.Substring(0, [Math]::Min(200, $Detail.Length)) }
  [ordered]@{ outcome = $Outcome; file = $Name; at = (Get-UwUtcNow); code = $Code; detail = $d }
}

# The Windows error code inside an exception (225 = the antivirus refused the file), or $null.
function Get-UwWin32Code {
  [CmdletBinding()]
  param($Exception)
  $e = $Exception
  while ($null -ne $e) {
    $h = [int]$e.HResult
    if (($h -band 0xFFFF0000) -eq [int]0x80070000) { return ($h -band 0xFFFF) }
    $e = $e.InnerException
  }
  return $null
}

# Writes the bytes next to the file and moves them over it (a reader never sees half a script).
function Save-UwScriptContent {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][byte[]]$Bytes)
  [System.IO.File]::WriteAllBytes("$Path.tmp", $Bytes)
  Move-Item -LiteralPath "$Path.tmp" -Destination $Path -Force
}

function Sync-UwScriptFile {
  [CmdletBinding()]
  param([string]$Name, [string]$Path, [string]$Want, [string]$HubUrl)
  try {
    $r = Invoke-UwHttp -Method 'GET' -Url "$HubUrl/agent/v1/scripts/$Name"
  } catch {
    return Format-UwUpdateOutcome 'download_failed' $Name $null "$_"
  }
  if ($r.Status -ne 200) { return Format-UwUpdateOutcome 'download_failed' $Name $null "HTTP $($r.Status)" }
  if ((Get-UwSha256Hex -Bytes $r.Body) -ne $Want) { return Format-UwUpdateOutcome 'hash_mismatch' $Name }
  try {
    Save-UwScriptContent -Path $Path -Bytes $r.Body
  } catch {
    Remove-Item -LiteralPath "$Path.tmp" -Force -ErrorAction SilentlyContinue
    $code = Get-UwWin32Code $_.Exception
    return Format-UwUpdateOutcome 'write_blocked' $Name $code $_.Exception.Message
  }
  # On-access scanners act right after the write: look again a moment later.
  Wait-UwSecond -Seconds 2
  if ((Get-UwFileSha256 -Path $Path) -ne $Want) {
    return Format-UwUpdateOutcome 'removed_after_write' $Name $null 'o arquivo sumiu ou mudou logo depois de gravado'
  }
  return Format-UwUpdateOutcome 'updated' $Name
}

# ------------------------------------------------------------------ antivirus (FR-604, ADR-060)

# How often the antivirus is read, and when an unchanged report is sent again anyway (another hub).
$script:UwAvCheckMs = 15L * 60000
$script:UwAvResendMs = 6L * 3600000

<#
  Raw antivirus facts: the products Windows Security Center knows and, when Microsoft Defender is
  there, its detections. Third-party products have no common history API (ADR-060).
#>
function Get-UwAntivirusRaw {
  [CmdletBinding()]
  param()
  Assert-UwRealSystem 'Get-UwAntivirusRaw'
  $products = @()
  try {
    $products = @(Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName 'AntiVirusProduct' -ErrorAction Stop |
        ForEach-Object { @{ name = [string]$_.displayName; state = [long]$_.productState } })
  } catch { Write-Verbose "Central de Segurança: $_" } # Windows Server has no Security Center
  $detections = @()
  if (Get-Command -Name 'Get-MpThreatDetection' -ErrorAction SilentlyContinue) {
    try {
      $names = @{}
      try { foreach ($t in @(Get-MpThreat -ErrorAction Stop)) { $names[[string]$t.ThreatID] = [string]$t.ThreatName } } catch { Write-Verbose "$_" }
      $detections = @(Get-MpThreatDetection -ErrorAction Stop | ForEach-Object {
          @{ at = $_.InitialDetectionTime; resources = @($_.Resources); threat = $names[[string]$_.ThreatID]; status = [int]$_.ThreatStatusID }
        })
    } catch { Write-Verbose "Defender: $_" }
  }
  @{ products = $products; detections = $detections }
}

# What Microsoft Defender did (ThreatStatusID), in the panel's words; unknown codes say nothing.
$script:UwDefenderAction = @{ 2 = 'limpo'; 3 = 'quarentena'; 4 = 'removido'; 5 = 'permitido'; 6 = 'bloqueado' }

<#
  The contract's `antivirus` object (FR-604.1): product names with enabled/up-to-date decoded from
  productState (unknown bits: null), and the detections of the last 14 days that touch UniWake —
  file names only, newest first.
#>
function ConvertTo-UwAntivirusInfo {
  [CmdletBinding()]
  param([Parameter(Mandatory)][hashtable]$Raw, [Parameter(Mandatory)][long]$Now)
  $products = @(foreach ($p in @($Raw.products)) {
      if (-not $p.name) { continue }
      $hex = '{0:X6}' -f [long]$p.state
      $enabled = $null
      if ($hex.Length -eq 6) {
        $on = $hex.Substring(2, 2)
        if ($on -in @('10', '11')) { $enabled = $true } elseif ($on -in @('00', '01')) { $enabled = $false }
        $sig = $hex.Substring(4, 2)
        $upToDate = $null
        if ($sig -eq '00') { $upToDate = $true } elseif ($sig -eq '10') { $upToDate = $false }
      } else { $upToDate = $null }
      [ordered]@{ name = ([string]$p.name).Substring(0, [Math]::Min(100, ([string]$p.name).Length)); enabled = $enabled; upToDate = $upToDate }
    })
  $since = $Now - 14L * 86400000
  $found = foreach ($d in @($Raw.detections)) {
    if ($null -eq $d.at) { continue }
    $at = ([DateTimeOffset][datetime]$d.at).ToUnixTimeMilliseconds()
    if ($at -lt $since) { continue }
    $hit = @(@($d.resources) | Where-Object { [string]$_ -match '\\UniWake\\|uniwake-[a-z]+\.ps1' }) | Select-Object -First 1
    if (-not $hit) { continue }
    $file = [regex]::Match([string]$hit, 'uniwake-[a-z]+\.ps1', 'IgnoreCase').Value
    if (-not $file) { $file = Split-Path -Leaf (([string]$hit) -replace '^[A-Za-z]+:_', '') }
    $threat = [string]$d.threat
    if (-not $threat) { $threat = 'desconhecida' }
    $action = $null
    if ($script:UwDefenderAction.ContainsKey([int]$d.status)) { $action = $script:UwDefenderAction[[int]$d.status] }
    [ordered]@{
      at = $at; threat = $threat.Substring(0, [Math]::Min(120, $threat.Length))
      file = $file.Substring(0, [Math]::Min(80, $file.Length)); action = $action
    }
  }
  [ordered]@{
    products   = @($products | Select-Object -First 6)
    detections = @(@($found) | Sort-Object { $_.at } -Descending | Select-Object -First 10)
  }
}

<#
  The antivirus part to send now, or $null when nothing changed (FR-604.1): read every 15 minutes, or
  at once after a blocked update or a repair; sent when it changed or every 6 hours. Returns
  @{ Report; Hash } so the caller marks it sent only once a hub took it.
#>
function Get-UwAntivirusReport {
  [CmdletBinding()]
  param([Parameter(Mandatory)][hashtable]$Health, [Parameter(Mandatory)][long]$Now, [switch]$Force)
  if (-not $Force -and $Now - $Health.avCheckedAt -lt $script:UwAvCheckMs) {
    # Field test 2026-10-17: the first reading happens before the hub announced health, so no hub
    # took it; offer it again instead of waiting 15 minutes for the next reading.
    if ($null -ne $Health.av -and $Health.avPendingHash -and $Health.avPendingHash -ne $Health.avHash) {
      return @{ Report = $Health.av; Hash = $Health.avPendingHash }
    }
    return $null
  }
  $Health.avCheckedAt = $Now
  $av = ConvertTo-UwAntivirusInfo -Raw (Get-UwAntivirusRaw) -Now $Now
  $hash = Get-UwSha256Hex -Bytes ([System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $av -Depth 5 -Compress)))
  $Health.av = $av
  $Health.avPendingHash = $hash
  if ($hash -eq $Health.avHash -and $Now - $Health.avSentAt -lt $script:UwAvResendMs) { return $null }
  return @{ Report = $av; Hash = $hash }
}

# A blocked update or a repair note newer than the last antivirus reading: read it again now.
function Test-UwAntivirusDue {
  [CmdletBinding()]
  [OutputType([bool])]
  param([Parameter(Mandatory)][hashtable]$Health, [AllowEmptyCollection()][object[]]$Repairs = @())
  $u = $Health.update
  if ($null -ne $u -and [string](Get-UwProp $u 'outcome') -in @('write_blocked', 'removed_after_write') -and
    [long](Get-UwProp $u 'at' 0) -gt $Health.avCheckedAt) { return $true }
  foreach ($r in @($Repairs)) { if ([long]$r.at -gt $Health.avCheckedAt) { return $true } }
  return $false
}

# ------------------------------------------------------------------ self-install and repair (ADR-059)

<#
  The repair task's command (FR-603.4): inline, so a quarantined script file cannot disable it. When
  a script is missing or differs from the verified copy, it restores the copy and appends a note to
  repairs.log (the agent reports it); when it cannot, it tells the hubs (POST /agent/v1/alert with
  the device token). It runs nothing it receives. Single quotes only: it sits inside -Command "...".
#>
function Get-UwRepairCommand {
  [CmdletBinding()]
  [OutputType([string])]
  param([Parameter(Mandatory)][string]$AgentDir)
  $d = $AgentDir.Replace("'", "''")
  @(
    "`$ErrorActionPreference='Stop';`$d='$d';`$c=Join-Path `$d 'copia';`$m=Join-Path `$c 'manifest.json'"
    "if(-not(Test-Path -LiteralPath `$m)){exit 0}"
    "`$h={param(`$x) if(Test-Path -LiteralPath `$x){(Get-FileHash -LiteralPath `$x -Algorithm SHA256).Hash}else{''}}"
    "`$man=Get-Content -Raw -LiteralPath `$m|ConvertFrom-Json"
    "foreach(`$p in `$man.PSObject.Properties){`$f=Join-Path `$d `$p.Name;if((& `$h `$f) -eq `$p.Value){continue}"
    "`$why='missing';if(Test-Path -LiteralPath `$f){`$why='changed'};`$out='not_restored';`$s=Join-Path `$c `$p.Name"
    "try{if((& `$h `$s) -eq `$p.Value){Copy-Item -LiteralPath `$s -Destination `$f -Force;if((& `$h `$f) -eq `$p.Value){`$out='restored'}}}catch{}"
    "`$at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()"
    "Add-Content -LiteralPath (Join-Path `$d 'repairs.log') -Value (@{at=`$at;file=`$p.Name;reason=`$why;outcome=`$out}|ConvertTo-Json -Compress)"
    "if(`$out -ne 'restored'){try{`$cfg=Get-Content -Raw -LiteralPath (Join-Path `$d 'config.json')|ConvertFrom-Json"
    "`$t=(Get-Content -Raw -LiteralPath (Join-Path `$d 'token.txt')).Trim()"
    "`$b=@{protocol=1;kind='agent_missing';file=`$p.Name;at=`$at}|ConvertTo-Json -Compress"
    "foreach(`$hub in @(`$cfg.hubs)){foreach(`$u in @(`$hub.urls)){try{Invoke-WebRequest -UseBasicParsing -Method Post -Uri (`$u+'/agent/v1/alert') -Headers @{Authorization=('Bearer '+`$t)} -ContentType 'application/json' -Body `$b -TimeoutSec 10|Out-Null;break}catch{}}}}catch{}}}"
  ) -join ';'
}

# "Back from sleep or hibernation" (Power-Troubleshooter event 1).
$script:UwResumeSubscription = '<QueryList><Query Id="0" Path="System"><Select Path="System">*[System[Provider[@Name=''Microsoft-Windows-Power-Troubleshooter''] and EventID=1]]</Select></Query></QueryList>'

<#
  Install level 3 (field test 2026-10-18): after the notebook came back from hibernation, the
  every-minute trigger of "UniWake" stopped firing until something started the task (the scheduler
  kept moving "next run" forward; cause não verificado). A trigger on resume starts it, which brings
  the repetition back. Adds it to the existing task, keeping its other triggers.
#>
function Add-UwResumeTrigger {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$TaskName = 'UniWake')
  Assert-UwRealSystem 'Add-UwResumeTrigger'
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  foreach ($t in @($task.Triggers)) {
    if ($t.CimClass.CimClassName -eq 'MSFT_TaskEventTrigger' -and [string]$t.Subscription -match 'Power-Troubleshooter') { return }
  }
  if (-not $PSCmdlet.ShouldProcess($TaskName, 'Executar ao voltar da suspensão ou hibernação')) { return }
  $class = Get-CimClass -ClassName MSFT_TaskEventTrigger -Namespace 'Root/Microsoft/Windows/TaskScheduler'
  $resume = New-CimInstance -CimClass $class -ClientOnly
  $resume.Enabled = $true
  $resume.Subscription = $script:UwResumeSubscription
  Set-ScheduledTask -TaskName $TaskName -Trigger (@($task.Triggers) + $resume) | Out-Null
}

# Registers "UniWake Reparo" (SYSTEM, at start-up and every 30 minutes).
function Register-UwRepairTask {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([Parameter(Mandatory)][string]$Command)
  Assert-UwRealSystem 'Register-UwRepairTask'
  if (-not $PSCmdlet.ShouldProcess('UniWake Reparo', 'Registrar tarefa agendada')) { return }
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command `"$Command`""
  $triggers = @(
    (New-ScheduledTaskTrigger -AtStartup),
    (New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddMinutes(5)) -RepetitionInterval (New-TimeSpan -Minutes 30))
  )
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
  $principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -RunLevel Highest
  Register-ScheduledTask -TaskName 'UniWake Reparo' -Action $action -Trigger $triggers `
    -Settings $settings -Principal $principal -Force | Out-Null
}

<#
  Keeps agent\copia\ in step with the scripts whose bytes match the signed hashes (FR-603.3): only a
  file verified against a signed answer is copied, so the repair task never restores anything else.
#>
function Update-UwVerifiedCopy {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([Parameter(Mandatory)]$Scripts)
  $dir = Join-Path $script:UwAgentDir 'copia'
  $manifestPath = Join-Path $dir 'manifest.json'
  $old = Read-UwJson $manifestPath $null
  $manifest = [ordered]@{}
  $changed = $false
  foreach ($name in 'uniwake-agent.ps1', 'uniwake-aviso.ps1') {
    $want = [string](Get-UwProp (Get-UwProp $Scripts $name) 'sha256' '')
    $source = Join-Path $script:UwAgentDir $name
    $copy = Join-Path $dir $name
    if (-not $want -or (Get-UwFileSha256 -Path $source) -ne $want) {
      # Not verified now: keep what the copy already had.
      $kept = [string](Get-UwProp $old $name '')
      if ($kept -and (Get-UwFileSha256 -Path $copy) -eq $kept) { $manifest[$name] = $kept }
      continue
    }
    if ((Get-UwFileSha256 -Path $copy) -ne $want) {
      if (-not $PSCmdlet.ShouldProcess($copy, 'Atualizar cópia conferida')) { continue }
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      Copy-Item -LiteralPath $source -Destination $copy -Force
      $changed = $true
    }
    $manifest[$name] = $want
  }
  if ($changed -or $null -eq $old -or (ConvertTo-Json $manifest -Compress) -ne (ConvertTo-Json $old -Compress)) {
    Save-UwJson $manifestPath $manifest
  }
}

<#
  FR-603.3: applies the install steps newer than the machine's level, so prepared machines take agent
  changes without "Preparar máquinas". Level 2 (v1.6.0): the verified copy and the repair task.
  Level 3: "UniWake" also runs when the PC comes back from sleep or hibernation.
  Failures are retried at most hourly and never stop the run.
#>
function Invoke-UwSelfInstall {
  [CmdletBinding()]
  param([Parameter(Mandatory)]$Scripts, [Parameter(Mandatory)][hashtable]$Paths, [Parameter(Mandatory)][hashtable]$Health, [long]$Now)
  Update-UwVerifiedCopy -Scripts $Scripts
  $config = Read-UwJson $Paths.Config $null
  if ($null -eq $config) { return }
  $level = [int](Get-UwProp $config 'installLevel' 1)
  if ($level -ge $script:UwInstallLevel) { return }
  $last = [long](Get-UwProp $Health 'installTriedAt' 0)
  if ($Health.ContainsKey('installTriedAt')) { $last = [long]$Health.installTriedAt }
  if ($Now - $last -lt 3600000L) { return }
  $Health.installTriedAt = $Now
  if ($level -lt 2) { Register-UwRepairTask -Command (Get-UwRepairCommand -AgentDir $script:UwAgentDir) }
  if ($level -lt 3) { Add-UwResumeTrigger }
  # Only failures wait an hour: a frozen machine loses the task at every restart (M29-R).
  $Health.installTriedAt = 0L
  $out = [ordered]@{}
  foreach ($p in $config.PSObject.Properties) { $out[$p.Name] = $p.Value }
  $out['installLevel'] = $script:UwInstallLevel
  Save-UwJson $Paths.Config $out
}

# The repair task's notes (repairs.log), newest last; the file is trimmed to the last 20.
function Read-UwRepairNote {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $lines = @(Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue | Where-Object { $_ })
  if ($lines.Count -gt 50) { Set-Content -LiteralPath $Path -Value ($lines | Select-Object -Last 20) -Encoding UTF8 }
  foreach ($l in @($lines | Select-Object -Last 10)) {
    try {
      $n = $l | ConvertFrom-Json
      if ([string]$n.outcome -in @('restored', 'not_restored') -and [string]$n.reason -in @('missing', 'changed')) {
        [ordered]@{ at = [long]$n.at; file = [string]$n.file; reason = [string]$n.reason; outcome = [string]$n.outcome }
      }
    } catch {
      Write-Verbose "nota de reparo ilegível: $l"
    }
  }
}

<#
  ADR-046: the "UniWake Aviso" task runs as the logged-on user, who must be able to read the warning
  script. Writing it again (self-update since v1.3, the repair task's copy) left only the folder's
  inherited rights (SYSTEM, Administrators): the warning window could not start and Windows showed
  its own notice, without "Adiar" (field test 2026-10-18). Checked every run, put back when missing.
  Returns $true when it had to put it back.
#>
function Repair-UwWarningAccess {
  [CmdletBinding(SupportsShouldProcess = $true)]
  [OutputType([bool])]
  param([string]$Path = (Join-Path $script:UwAgentDir 'uniwake-aviso.ps1'))
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  # Only the access part: writing the audit part (SACL) needs a privilege we do not ask for.
  $item = Get-Item -LiteralPath $Path
  $acl = $item.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
  $users = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')
  $rx = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute
  foreach ($ace in $acl.Access) {
    if ($ace.AccessControlType -ne 'Allow') { continue }
    try { $sid = $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]) } catch { continue }
    if ($sid -eq $users -and ($ace.FileSystemRights -band $rx) -eq $rx) { return $false }
  }
  if (-not $PSCmdlet.ShouldProcess($Path, 'Permitir leitura pelos usuários')) { return $false }
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($users, 'ReadAndExecute', 'Allow')))
  $item.SetAccessControl($acl)
  return $true
}

# ------------------------------------------------------------------ one run

<#
  One run of the task (every minute, at start-up, or woken by "UniWake Despertar"). Exit codes:
  0 ok, 2 not prepared (no config or token), 3 agent folder changed (refuses to run), 4 token refused
  by every hub that answered.
#>
function Invoke-UwAgent {
  [CmdletBinding()]
  param()
  $script:UwRealSystem = $true
  if (-not (Test-UwAgentFolder)) { return 3 }
  # M18-D: SYSTEM writes the agenda in the persistent folder; a folder users can write (a
  # ThawSpace often is) would let them redirect those writes with links. Locked down by the
  # preparation; if it is not (anymore), the agent's own folder is used instead.
  $config = Read-UwJson (Join-Path $script:UwAgentDir 'config.json') $null
  $persistent = Get-UwProp $config 'persistentPath'
  if ($persistent -and (Test-Path -LiteralPath $persistent) -and -not (Test-UwAgentFolder -Path $persistent)) {
    $script:UwIgnorePersistent = $true
  }
  return Invoke-UwRun
}

# Default warning texts until the first answer arrives (owner Q-8).
$script:UwDefaultMessages = [pscustomobject]@{
  warning  = 'Este computador será desligado às {hora} pela equipe de TI. Salve seus arquivos: o que não for salvo será perdido.'
  postpone = 'Você pode adiar mais {n} vez(es).'
}

# Heartbeat, check-in, then the next order or agenda item (orders first).
function Invoke-UwRun {
  [CmdletBinding()]
  param()
  $paths = Get-UwPathSet
  $config = Read-UwJson $paths.Config $null
  if ($null -eq $config -or -not (Test-Path -LiteralPath $paths.Token)) { return 2 }
  $state = Read-UwState $paths.State
  $lastBeat = Get-UwProp (Read-UwJson $paths.Heartbeat $null) 'at'
  Save-UwJson $paths.Heartbeat ([ordered]@{ at = (Get-UwUtcNow) })
  $ctx = @{
    Paths = $paths; Config = $config; State = $state; Last = $null
    Boot = (Get-UwBootTime); Freeze = (Get-UwFreezeInfo); Power = (Get-UwPowerInfo); Session = (Get-UwSessionInfo)
    Health = (Read-UwHealthState $paths.Health); Antivirus = $null; AntivirusHash = $null
    Repairs = @(Read-UwRepairNote -Path (Join-Path $script:UwAgentDir 'repairs.log'))
  }
  $resume = Get-UwResume -LastBeat $lastBeat -Boot $ctx.Boot -Now (Get-UwUtcNow)
  if ($null -ne $resume) { $ctx.Health.lastResume = $resume }
  $ctx.Hibernate = $null
  try { $ctx.Hibernate = Get-UwHibernateInfo } catch { Write-Verbose "hibernação: $_" }
  try {
    $av = Get-UwAntivirusReport -Health $ctx.Health -Now (Get-UwUtcNow) -Force:(Test-UwAntivirusDue -Health $ctx.Health -Repairs $ctx.Repairs)
    if ($null -ne $av) { $ctx.Antivirus = $av.Report; $ctx.AntivirusHash = $av.Hash }
  } catch { Write-Verbose "antivirus: $_" }
  # FR-308.4: data kept in a folder that survives freezing (ThawSpace, UWF exclusion) when configured.
  $persistent = Get-UwProp $config 'persistentPath'
  $ctx.Freeze = @{ product = $ctx.Freeze.product; state = $ctx.Freeze.state; persistent = [bool]$persistent }
  # No GetNewClosure(): it runs the block in another module, without this script's functions.
  $script:UwPollContext = $ctx
  $poll = { Invoke-UwPoll -Context $script:UwPollContext }

  $first = & $poll
  if ($null -ne $first -and $first.ContainsKey('Unauthorized')) { return 4 }
  if ($null -ne $ctx.Last) {
    try {
      [void](Sync-UwScript -Scripts $ctx.Last.Answer.scripts -HubUrl $ctx.Last.Url -Health $ctx.Health)
    } catch { Write-Verbose "update: $_" }
    try {
      Invoke-UwSelfInstall -Scripts $ctx.Last.Answer.scripts -Paths $paths -Health $ctx.Health -Now (Get-UwUtcNow)
    } catch { Write-Verbose "self-install: $_" }
    try {
      $prevent = [bool](Get-UwProp (Get-UwProp $ctx.Last.Answer 'power') 'preventSleep' $false)
      Invoke-UwSleepPolicy -Prevent $prevent -Health $ctx.Health -Now (Get-UwUtcNow) -Power $ctx.Power -Hibernate $ctx.Hibernate
    } catch { Write-Verbose "energia: $_" }
    Save-UwHealthState $paths.Health $ctx.Health
  }
  # Also with the hub unreachable: a copy restored by "UniWake Reparo" needs it as well.
  try {
    if (Repair-UwWarningAccess) { Write-Verbose 'aviso: leitura pelos usuários restaurada' }
  } catch { Write-Verbose "aviso: $_" }
  $messages = $script:UwDefaultMessages
  if ($null -ne $ctx.Last) { $messages = $ctx.Last.Answer.message }

  $now = (Get-UwUtcNow) + $state.offsetMs
  $job = Get-UwNextJob -State $state -Paths $paths -Now $now -Boot $ctx.Boot -LastBeat $lastBeat `
    -Session $ctx.Session -Freeze $ctx.Freeze
  if ($null -ne $job) {
    $id = $job.Occurrence
    if ($job.Kind -eq 'order') { $id = $job.Order }
    $report = Invoke-UwExecution -Job $job -State $state -Messages $messages -Poll $poll -Freeze $ctx.Freeze
    $state.doneIds[[string]$id] = (Get-UwUtcNow) + $state.offsetMs
    foreach ($o in @($state.orders | Where-Object { $_.uuid -eq $job.Order })) { [void]$state.orders.Remove($o) }
    if ($null -ne $report) {
      Add-UwReport $paths.Reports $report
      Save-UwState $paths.State $state ((Get-UwUtcNow) + $state.offsetMs)
      try { [void](& $poll) } catch { Write-Verbose "final report: $_" } # best effort before Windows stops
    }
  }
  Save-UwState $paths.State $state ((Get-UwUtcNow) + $state.offsetMs)
  return 0
}

# One check-in with the queued reports and pending receipts; applies the verified answer.
function Invoke-UwPoll {
  [CmdletBinding()]
  param([Parameter(Mandatory)][hashtable]$Context)
  $paths = $Context.Paths
  $token = ([System.IO.File]::ReadAllText($paths.Token)).Trim()
  $cfg = Read-UwJson $paths.Config $Context.Config
  $queue = @(Read-UwReportQueue $paths.Reports)
  $acks = @($Context.State.acked)
  $request = @{
    BootTime = $Context.Boot; Freeze = $Context.Freeze; Power = $Context.Power; Session = $Context.Session
    Reports = $queue; AckedOrders = $acks
  }
  $health = $null
  $report = $null
  if ($Context.ContainsKey('Health') -and $null -ne $Context.Health) {
    $health = $Context.Health
    $hib = $null
    if ($Context.ContainsKey('Hibernate')) { $hib = $Context.Hibernate }
    $report = Get-UwHealthReport -Health $health -Config $cfg -Repairs @($Context.Repairs) -Antivirus $Context.Antivirus -Hibernate $hib
  }
  $features = @{}
  if ($null -ne $health) { $features = $health.hubFeatures }
  $result = Invoke-UwCheckin -Config $cfg -Token $token -Request $request -Health $report -Features $features
  if ($null -eq $result -or $result.ContainsKey('Unauthorized')) { return $result }
  if ($null -ne $health) {
    # What this hub accepts from now on (a hub without the list accepts no health).
    $health.hubFeatures[[string]$result.Hub.keyId] = @($result.Features)
    if ($result.SentHealth -and $null -ne $Context.Antivirus -and $Context.ContainsKey('AntivirusHash')) {
      # A hub took it: unchanged readings are not sent again for a while.
      $health.avHash = $Context.AntivirusHash
      $health.avSentAt = [long]$result.Answer.serverTime
      $Context.Antivirus = $null
    }
    Save-UwHealthState $paths.Health $health
  }
  $extra = Invoke-UwAnswer -Result $result -State $Context.State -Paths $paths -Config $cfg -SentAcks ([string[]]$acks)
  foreach ($r in $extra) { Add-UwReport $paths.Reports $r }
  $Context.Last = $result
  Save-UwState $paths.State $Context.State ([long]$result.Answer.serverTime)
  return $result
}

<#
  The next job: a pending order (FR-305) or the due agenda item (FR-303, ADR-045). Skipped items
  are reported and marked here. The job is marked handled before it runs, so a crash during the
  warning never runs it twice.
#>
function Get-UwNextJob {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][hashtable]$State,
    [Parameter(Mandatory)][hashtable]$Paths,
    [Parameter(Mandatory)][long]$Now,
    $Boot,
    $LastBeat,
    [Parameter(Mandatory)][hashtable]$Session,
    [Parameter(Mandatory)][hashtable]$Freeze
  )
  $hubBoot = $null
  if ($null -ne $Boot) { $hubBoot = [long]$Boot + $State.offsetMs }
  $order = @($State.orders | Select-Object -First 1)
  if ($order.Count -gt 0) {
    $o = $order[0]
    # ADR-053: the order's run id (a schedule occurrence) is handled from now on, so the agenda item
    # with the same id never runs after it.
    $occ = [string](Get-UwProp $o 'occurrence' '')
    if ($occ) {
      $State.doneIds[$occ] = $Now
      Save-UwState $Paths.State $State $Now
    } else { $occ = $null }
    $planned = Get-UwProp $o 'plannedAt' $null
    if ($null -ne $planned) { $planned = [long]$planned }
    # Field test 2026-10-18 (owner): someone may turn a lab PC off before the scheduled time. Started
    # after T (or, for a manual order, after it was given), the PC was off then: as for agenda items
    # (AC-303-05) it is not shut down — whoever turned it on is using it. A resume from sleep or
    # hibernation keeps the boot time, so those still shut down.
    $ref = $planned
    if ($null -eq $ref) {
      $issued = Get-UwProp $o 'issuedAt' $null
      if ($null -ne $issued) { $ref = [long]$issued }
    }
    if ($null -ne $ref -and $null -ne $hubBoot -and $hubBoot -gt $ref) {
      $State.doneIds[[string]$o.uuid] = $Now
      [void]$State.orders.Remove($o)
      Add-UwReport $Paths.Reports (Format-UwReport -Occurrence $occ -Order ([string]$o.uuid) -Action ([string]$o.action) `
          -Outcome 'skipped' -Reason 'was_off' -PlannedAt $planned -Session $Session -FreezeState $Freeze.state `
          -Detail 'máquina estava desligada e foi ligada depois')
      Save-UwState $Paths.State $State $Now
      return $null
    }
    return @{
      Kind = 'order'; Order = [string]$o.uuid; Occurrence = $occ; Action = [string]$o.action
      At = $Now + [long]$o.warningMinutes * $script:UwMinute; PlannedAt = $planned
      Policy = $o; WasAsleep = $false; LateMinutes = $null
    }
  }
  $hubBoot = $null
  if ($null -ne $Boot) { $hubBoot = [long]$Boot + $State.offsetMs }
  $hubBeat = $null
  if ($null -ne $LastBeat) { $hubBeat = [long]$LastBeat + $State.offsetMs }
  $due = Get-UwDueItem -Agenda (Read-UwJson $Paths.Agenda $null) -State $State -Now $Now -BootTime $hubBoot -LastHeartbeat $hubBeat
  if ($null -eq $due) { return $null }
  $item = $due.Item
  $State.doneIds[[string]$item.occurrence] = $Now
  if ($due.Kind -eq 'skip') {
    $detail = 'máquina estava desligada'
    if ($due.Reason -eq 'late_wake') { $detail = "pulado: acordou $($due.LateMinutes) min após o horário" }
    Add-UwReport $Paths.Reports (Format-UwReport -Occurrence $item.occurrence -Action 'shutdown' -Outcome 'skipped' `
        -Reason $due.Reason -PlannedAt ([long]$item.at) -Session $Session -WasAsleep $due.WasAsleep `
        -LateMinutes $due.LateMinutes -FreezeState $Freeze.state -Detail $detail)
    Save-UwState $Paths.State $State $Now
    return $null
  }
  Save-UwState $Paths.State $State $Now
  $at = [long]$item.at
  # Late (slept through it): a fresh warning from now, never a shutdown without one.
  if ($null -ne $due.LateMinutes) { $at = $Now + [long]$item.warningMinutes * $script:UwMinute }
  return @{
    Kind = 'item'; Order = $null; Occurrence = [string]$item.occurrence; Action = 'shutdown'
    At = $at; PlannedAt = [long]$item.at; Policy = $item
    WasAsleep = [bool]$due.WasAsleep; LateMinutes = $due.LateMinutes
  }
}

# Dot-sourcing (tests) only loads the functions above.
if ($MyInvocation.InvocationName -ne '.') {
  if ($Wake) { Write-Verbose 'Woken by UniWake Despertar for an agenda item.' }
  exit (Invoke-UwAgent)
}
