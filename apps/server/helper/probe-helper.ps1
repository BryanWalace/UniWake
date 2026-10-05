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
} catch { }

# Startup can take seconds on a cold machine; the hub waits for this line before sending work.
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim() -eq '') { continue }
    try {
        $req = $line | ConvertFrom-Json
        $targets = @($req.targets)
        $timeout = [int]$req.timeout
        $pings = New-Object System.Collections.Generic.List[System.Net.NetworkInformation.Ping]
        $tasks = New-Object System.Collections.Generic.List[System.Threading.Tasks.Task]
        foreach ($t in $targets) {
            $p = New-Object System.Net.NetworkInformation.Ping
            $pings.Add($p)
            $tasks.Add($p.SendPingAsync([string]$t, $timeout))
        }
        if ($tasks.Count -gt 0) {
            try { [void][System.Threading.Tasks.Task]::WaitAll($tasks.ToArray(), $timeout + 2000) } catch { }
        }
        $results = New-Object System.Collections.Generic.List[object]
        for ($i = 0; $i -lt $tasks.Count; $i++) {
            $task = $tasks[$i]
            if ($task.Status -eq 'RanToCompletion') {
                $results.Add(@{ t = [string]$targets[$i]; s = [string]$task.Result.Status; ms = [int]$task.Result.RoundtripTime })
            } else {
                $results.Add(@{ t = [string]$targets[$i]; s = 'Error'; ms = -1 })
            }
        }
        foreach ($p in $pings) { $p.Dispose() }
        $out = ConvertTo-Json -InputObject @{ id = $req.id; results = $results.ToArray() } -Compress -Depth 4
    } catch {
        $out = ConvertTo-Json -InputObject @{ id = $null; error = $_.Exception.Message } -Compress
    }
    [Console]::Out.WriteLine($out)
    [Console]::Out.Flush()
}
