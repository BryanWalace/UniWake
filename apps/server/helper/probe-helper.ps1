#Requires -Version 5.1
<#
  UniWake ICMP probe helper (ADR-019).
  Reads one JSON request per line on stdin:  {"id":1,"targets":["10.0.3.21"],"timeout":1000}
  Writes {"ready":true} once at startup, then one JSON response per line:
                                             {"id":1,"results":[{"t":"10.0.3.21","s":"Success","ms":1}]}
  Uses System.Net.NetworkInformation.Ping (IcmpSendEcho2): no admin rights, locale-independent
  status names. Only JSON is written to stdout; nothing is read from or written to disk.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Warm up: the first Ping loads assemblies and compiles code, which can take seconds on a cold
# machine. Doing it before "ready" keeps that delay out of the first real request's deadline.
try {
    $warm = New-Object System.Net.NetworkInformation.Ping
    [void]$warm.SendPingAsync('127.0.0.1', 1000).Wait(5000)
    $warm.Dispose()
} catch { Write-Verbose "warm-up ping failed: $_" }

# Startup can take seconds on a cold machine; the hub waits for this line before sending work.
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim() -eq '') { continue }
    $reqId = $null
    try {
        $req = $line | ConvertFrom-Json
        $reqId = $req.id
        $targets = @($req.targets)
        $timeout = [int]$req.timeout
        $pings = New-Object System.Collections.Generic.List[System.Net.NetworkInformation.Ping]
        # One slot per target: $null when that target could not even be sent (empty or invalid
        # address). v1.6 field fix: one bad address used to fail the whole batch.
        $tasks = New-Object System.Collections.Generic.List[object]
        foreach ($t in $targets) {
            try {
                $p = New-Object System.Net.NetworkInformation.Ping
                $pings.Add($p)
                $tasks.Add($p.SendPingAsync([string]$t, $timeout))
            } catch {
                $tasks.Add($null)
            }
        }
        $started = @($tasks | Where-Object { $null -ne $_ })
        if ($started.Count -gt 0) {
            try { [void][System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]$started, $timeout + 2000) } catch { Write-Verbose "some pings failed: $_" }
        }
        $results = New-Object System.Collections.Generic.List[object]
        for ($i = 0; $i -lt $tasks.Count; $i++) {
            $task = $tasks[$i]
            if ($null -ne $task -and $task.Status -eq 'RanToCompletion') {
                $results.Add(@{ t = [string]$targets[$i]; s = [string]$task.Result.Status; ms = [int]$task.Result.RoundtripTime })
            } else {
                $results.Add(@{ t = [string]$targets[$i]; s = 'Error'; ms = -1 })
            }
        }
        foreach ($p in $pings) { $p.Dispose() }
        $out = ConvertTo-Json -InputObject @{ id = $reqId; results = $results.ToArray() } -Compress -Depth 4
    } catch {
        # Always answer with the request's id when it is known, so the hub never waits for a deadline.
        $out = ConvertTo-Json -InputObject @{ id = $reqId; error = $_.Exception.Message } -Compress
    }
    [Console]::Out.WriteLine($out)
    [Console]::Out.Flush()
}
