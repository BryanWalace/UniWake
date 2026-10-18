<#
.SYNOPSIS
  UniWake shutdown warning for the logged-on user (v1.3, FR-304, ADR-046). Run by the task
  "UniWake Aviso" (group Users, interactive) at logon and when the SYSTEM agent starts a warning.
.DESCRIPTION
  Shows the warning with a countdown and "Adiar" while postpones remain. Talks to the SYSTEM agent
  only through files: it reads ui\request\request.json (written by SYSTEM; users can only read it)
  and writes small answers to ui\response\ ("alive" so the agent knows the window is up, and
  "postpone"). The agent enforces every limit itself; nothing written here can do more than ask.
  Built-in components only (PowerShell 5.1, Windows Forms).
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:UwUiDir = Join-Path $env:ProgramData 'UniWake\ui'
$script:UwWritten = New-Object System.Collections.ArrayList

function Get-UwAvisoPathSet {
  [CmdletBinding()]
  param()
  @{
    Request  = Join-Path $script:UwUiDir 'request\request.json'
    Response = Join-Path $script:UwUiDir 'response'
  }
}

# The current request, or $null when there is no warning (or it cannot be read).
function Read-UwAvisoRequest {
  [CmdletBinding()]
  param()
  $path = (Get-UwAvisoPathSet).Request
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    $r = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    if (-not $r.requestId) { return $null }
    return $r
  } catch {
    return $null
  }
}

# One answer for the agent: a new file each time (the agent counts each response id once).
function Write-UwAvisoResponse {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$RequestId,
    [Parameter(Mandatory)][ValidateSet('alive', 'postpone')][string]$Kind
  )
  $folder = (Get-UwAvisoPathSet).Response
  $id = [guid]::NewGuid().ToString()
  $path = Join-Path $folder "$Kind-$id.json"
  $json = ConvertTo-Json -Compress -InputObject ([ordered]@{
      requestId = $RequestId; responseId = $id; kind = $Kind
      at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    })
  [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
  # Field test 2026-10-18: one "alive" every 5 s piled up hundreds of files in a long warning. The
  # agent only needs the newest one, so the earlier "alive" files of this window go now.
  if ($Kind -eq 'alive') {
    foreach ($old in @($script:UwWritten | Where-Object { (Split-Path -Leaf $_) -like 'alive-*' })) {
      Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue
      [void]$script:UwWritten.Remove($old)
    }
  }
  [void]$script:UwWritten.Add($path)
  return $path
}

# The files this window wrote go when it closes (SYSTEM never deletes in this folder).
function Clear-UwAvisoResponse {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param()
  foreach ($p in @($script:UwWritten)) {
    if ((Test-Path -LiteralPath $p) -and $PSCmdlet.ShouldProcess($p, 'Remove')) {
      Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
    }
  }
  $script:UwWritten.Clear()
}

# "Faltam 4:59" (minutes:seconds to the shutdown time).
function Format-UwCountdown {
  [CmdletBinding()]
  [OutputType([string])]
  param([Parameter(Mandatory)][long]$AtMs, [Parameter(Mandatory)][long]$NowMs)
  $left = [Math]::Max(0, [int][Math]::Ceiling(($AtMs - $NowMs) / 1000))
  $verb = 'Desliga'
  return ('{0} em {1}:{2:00}' -f $verb, [Math]::Floor($left / 60), ($left % 60))
}

function Get-UwPostponeLabel {
  [CmdletBinding()]
  [OutputType([string])]
  param([Parameter(Mandatory)]$Request)
  return "Adiar $([int]$Request.postponeMinutes) min"
}

# The window (not unit-tested: everything it shows comes from the functions above).
function Show-UwAvisoWindow {
  [CmdletBinding()]
  param([Parameter(Mandatory)]$Request)
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $state = @{ Request = $Request; LastAlive = [DateTime]::MinValue }
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'UniWake — aviso de desligamento'
  $form.TopMost = $true
  $form.ControlBox = $false
  $form.FormBorderStyle = 'FixedDialog'
  $form.StartPosition = 'CenterScreen'
  $form.ClientSize = New-Object System.Drawing.Size(460, 210)
  $form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  $message = New-Object System.Windows.Forms.Label
  $message.SetBounds(16, 16, 428, 96)
  $form.Controls.Add($message)
  $countdown = New-Object System.Windows.Forms.Label
  $countdown.SetBounds(16, 116, 428, 28)
  $countdown.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
  $form.Controls.Add($countdown)
  $postpone = New-Object System.Windows.Forms.Button
  $postpone.SetBounds(16, 156, 200, 36)
  $form.Controls.Add($postpone)
  $postpone.Add_Click({
      $postpone.Enabled = $false # one click = one request; the agent answers with a new time
      [void](Write-UwAvisoResponse -RequestId $state.Request.requestId -Kind 'postpone')
    })
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 1000
  $timer.Add_Tick({
      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      $r = Read-UwAvisoRequest
      if ($null -eq $r -or $r.requestId -ne $state.Request.requestId -or $now -ge [long]$r.at) {
        $form.Close()
        return
      }
      if ([long]$r.at -ne [long]$state.Request.at) { $postpone.Enabled = $true } # postponed
      $state.Request = $r
      $message.Text = [string]$r.message
      $countdown.Text = Format-UwCountdown -AtMs ([long]$r.at) -NowMs $now
      $postpone.Text = Get-UwPostponeLabel -Request $r
      $postpone.Visible = [int]$r.postponesLeft -gt 0
      if (([DateTime]::UtcNow - $state.LastAlive).TotalSeconds -ge 5) {
        [void](Write-UwAvisoResponse -RequestId $r.requestId -Kind 'alive')
        $state.LastAlive = [DateTime]::UtcNow
      }
    })
  $message.Text = [string]$Request.message
  $countdown.Text = Format-UwCountdown -AtMs ([long]$Request.at) -NowMs ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  $postpone.Text = Get-UwPostponeLabel -Request $Request
  $postpone.Visible = [int]$Request.postponesLeft -gt 0
  [void](Write-UwAvisoResponse -RequestId $Request.requestId -Kind 'alive')
  $state.LastAlive = [DateTime]::UtcNow
  $timer.Start()
  try {
    [void]$form.ShowDialog()
  } finally {
    $timer.Stop()
    $form.Dispose()
  }
}

# At logon with no warning in progress there is nothing to show.
function Invoke-UwAviso {
  [CmdletBinding()]
  param()
  $request = Read-UwAvisoRequest
  if ($null -eq $request) { return 0 }
  try {
    Show-UwAvisoWindow -Request $request
  } finally {
    Clear-UwAvisoResponse
  }
  return 0
}

# Dot-sourcing (tests) only loads the functions above.
if ($MyInvocation.InvocationName -ne '.') {
  exit (Invoke-UwAviso)
}
