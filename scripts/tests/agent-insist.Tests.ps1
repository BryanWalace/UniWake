#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# v1.7.0 "Ligar e desligar garantidos" (spec §6f, ADR-063..066) on the lab-PC agent: the shutdown
# fallbacks and the watchdog that forces a shutdown that did not happen, the magic packet relayed for
# neighbours, the Wake-on-LAN settings kept on, and the local log whose errors reach the hub.
# Nothing real runs: every wrapper is mocked (FakeAgent.ps1) and the clock is fake.

BeforeAll {
  . (Join-Path $PSScriptRoot '..\agent\uniwake-agent.ps1')
  . (Join-Path $PSScriptRoot 'FakeAgent.ps1')
  $script:MIN = 60000L
  function Get-SpTime([int]$d, [int]$h, [int]$m = 0) {
    [DateTimeOffset]::new(2026, 11, $d, 0, 0, 0, [TimeSpan]::Zero).AddHours($h + 3).AddMinutes($m).ToUnixTimeMilliseconds()
  }
  $script:At = Get-SpTime 9 22 40
  $script:Occ = '6f1d2a3b-4c5d-5e6f-8a7b-000000000099'
  function Write-TestAgenda {
    Save-UwJson (Get-UwPathSet).Agenda ([ordered]@{
        version = 'bbbbbbbbbbbbbbbb'; window = [ordered]@{ from = (Get-SpTime 9 12); to = (Get-SpTime 20 12) }
        items = @([ordered]@{ occurrence = $script:Occ; at = $script:At; action = 'shutdown'; warningMinutes = 5; allowPostpone = $false; postponeMax = 0; postponeMinutes = 15 })
        nextWakes = @()
      })
  }
  function Get-TestLog { Get-Content -LiteralPath (Join-Path $script:UwDataDir 'agent.log') -Raw -Encoding UTF8 }
}

Describe 'Shutdown fallbacks (FR-703.1, ADR-064)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    $script:UwFake.Now = Get-SpTime 9 22 0
    $script:Calls = New-Object System.Collections.ArrayList
  }

  It 'AC-703-01: 1190 (a shutdown already scheduled in Windows) is cancelled and asked again; 1115 counts as done' {
    $script:Codes = [System.Collections.Queue]::new(@(1190, 0))
    Mock Invoke-UwShutdown { [void]$script:Calls.Add($Arguments -join ' '); if ($Arguments[0] -eq '/a') { return 0 }; $script:Codes.Dequeue() }
    $r = Invoke-UwPowerCommand -Action 'shutdown' -Seconds 30 -Comment 'x' -Fallback
    $r.Ok | Should -BeTrue
    $r.Method | Should -Be 'shutdown'
    @($script:Calls) | Should -Be @('/s /t 30 /c x', '/a', '/s /t 30 /c x')
    @($script:UwFake.Cim).Count | Should -Be 0

    Mock Invoke-UwShutdown { 1115 }
    (Invoke-UwPowerCommand -Action 'shutdown' -Seconds 30 -Fallback).Ok | Should -BeTrue
  }

  It 'AC-703-01: a failing shutdown.exe falls back to CIM (forced), then to Stop-Computer; restart uses the restart flags' {
    Mock Invoke-UwShutdown { 5 }
    $r = Invoke-UwPowerCommand -Action 'shutdown' -Seconds 30 -Fallback
    $r.Ok | Should -BeTrue
    $r.Method | Should -Be 'cim'
    $r.Detail | Should -BeLike '*shutdown.exe saiu com código 5*'
    @($script:UwFake.Cim) | Should -Be @(5)

    Mock Invoke-UwCimShutdown { [void]$script:UwFake.Cim.Add($Flags); throw 'RPC indisponível' }
    $r = Invoke-UwPowerCommand -Action 'restart' -Seconds 30 -Fallback
    $r.Method | Should -Be 'stop_computer'
    @($script:UwFake.Cim)[-1] | Should -Be 6
    @($script:UwFake.StopComputer) | Should -Be @($true)
    Get-TestLog | Should -Match 'ERRO \[desligar\] CIM: RPC indisponível'
  }

  It 'AC-703-01: without -Fallback (the native warning) nothing is forced, and the run still shuts down at its time' {
    Mock Invoke-UwShutdown { 5 }
    $r = Invoke-UwPowerCommand -Action 'shutdown' -Seconds 300
    $r.Ok | Should -BeFalse
    @($script:UwFake.Cim).Count | Should -Be 0
  }
}

Describe 'Watchdog: a shutdown that did not happen is forced (FR-703.2, ADR-064)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    Install-UwTestAgent -Hub (New-UwTestHub)
    $script:Boot = Get-SpTime 9 7 0
    Mock Get-UwBootTime { $script:Boot }
    $script:Calls = New-Object System.Collections.ArrayList
    Mock Invoke-UwShutdown { [void]$script:Calls.Add($Arguments -join ' '); 0 }
  }

  It 'AC-703-02: the run that shut down watches it; 3 min later with the same boot it forces shutdown /f /t 0, then CIM power-off, then Stop-Computer, then gives up' {
    Write-TestAgenda
    $script:UwFake.Now = Get-SpTime 9 22 35
    Invoke-UwRun | Should -Be 0
    $state = Read-UwState (Get-UwPathSet).State
    $state.watch | Should -Not -BeNullOrEmpty
    $state.watch.id | Should -Be $script:Occ
    $state.watch.boot | Should -Be $script:Boot
    $script:Calls.Clear()

    # 2 min after: still within the grace.
    $script:UwFake.Now = $script:At + 2 * $script:MIN
    [void](Invoke-UwRun)
    @($script:Calls).Count | Should -Be 0

    $script:UwFake.Now = $script:At + 4 * $script:MIN
    [void](Invoke-UwRun)
    @($script:Calls) | Should -Be @('/s /f /t 0')
    $script:UwFake.Now += $script:MIN
    [void](Invoke-UwRun)
    @($script:UwFake.Cim) | Should -Be @(12)
    $script:UwFake.Now += $script:MIN
    [void](Invoke-UwRun)
    @($script:UwFake.StopComputer) | Should -Be @($false)
    $script:UwFake.Now += $script:MIN
    [void](Invoke-UwRun)
    (Read-UwState (Get-UwPathSet).State).watch | Should -BeNullOrEmpty
    $h = Read-UwHealthState (Get-UwPathSet).Health
    @($h.escalations).Count | Should -Be 3
    @($h.escalations | ForEach-Object { $_.method }) | Should -Be @('shutdown_force', 'cim_force', 'stop_computer')
    $h.escalations[0].id | Should -Be $script:Occ
    Get-TestLog | Should -Match 'desisti'
    # The escalations go to the hub in the health report.
    (Get-UwHealthReport -Health $h -Config $null).escalations.Count | Should -Be 3
  }

  It 'AC-703-02: a new boot time ends the watch without forcing anything; an unknown boot time never forces' {
    $state = @{ watch = [ordered]@{ id = $script:Occ; action = 'restart'; at = 1000L; boot = 5L; attempts = 0 } }
    Invoke-UwWatchdog -State $state -Boot 9L -Now (1000L + 10 * $script:MIN) | Should -Be 'done'
    $state.watch | Should -BeNullOrEmpty
    $state = @{ watch = [ordered]@{ id = $script:Occ; action = 'shutdown'; at = 1000L; boot = 5L; attempts = 0 } }
    Invoke-UwWatchdog -State $state -Boot $null -Now (1000L + 10 * $script:MIN) | Should -Be 'unknown'
    @($script:Calls).Count | Should -Be 0
    $state = @{ watch = [ordered]@{ id = $script:Occ; action = 'shutdown'; at = 1000L; boot = 5L; attempts = 0 } }
    Invoke-UwWatchdog -State $state -Boot 5L -Now (1000L + 31 * $script:MIN) | Should -Be 'gave_up'
    Invoke-UwWatchdog -State @{ watch = $null } -Boot 5L -Now 0 | Should -Be 'none'
  }

  It 'AC-703-02: a PC that was off meanwhile (no heartbeat: Fast Startup keeps the boot time) is never forced' {
    $state = @{ watch = [ordered]@{ id = $script:Occ; action = 'shutdown'; at = 1000L; boot = 5L; attempts = 0 } }
    Invoke-UwWatchdog -State $state -Boot 5L -Now (1000L + 10 * $script:MIN) -WasDown $true | Should -Be 'done'
    @($script:Calls).Count | Should -Be 0
    # Through a run: last heartbeat 20 min ago, same boot time → nothing forced.
    Install-UwTestAgent -Hub (New-UwTestHub)
    $paths = Get-UwPathSet
    $st = Read-UwState $paths.State
    $st.watch = [ordered]@{ id = $script:Occ; action = 'shutdown'; at = $script:At; boot = $script:Boot; attempts = 0 }
    Save-UwState $paths.State $st $script:At
    Save-UwJson $paths.Heartbeat ([ordered]@{ at = $script:At })
    $script:UwFake.Now = $script:At + 20 * $script:MIN
    [void](Invoke-UwRun)
    @($script:Calls).Count | Should -Be 0
    (Read-UwState $paths.State).watch | Should -BeNullOrEmpty
  }

  It 'AC-703-02: a restart that came back is done; one that did not is forced with /r' {
    $state = @{ watch = [ordered]@{ id = $script:Occ; action = 'restart'; at = 1000L; boot = 5L; attempts = 0 } }
    Invoke-UwWatchdog -State $state -Boot 5L -Now (1000L + 4 * $script:MIN) | Should -Be 'forced'
    @($script:Calls) | Should -Be @('/r /f /t 0')
    $state.watch.attempts | Should -Be 1
  }
}

Describe 'Magic packet for neighbours (FR-701.3, ADR-063)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    $script:UwFake.Now = Get-SpTime 9 7 0
  }

  It 'AC-701-04: each valid MAC of the signed answer is broadcast on the hub ports and noted for the next check-in' {
    $h = Read-UwHealthState (Join-Path $TestDrive 'nada.json')
    $answer = [pscustomobject]@{ wake = [pscustomobject]@{ ports = @(9, 7); macs = @('00:AA:00:00:00:01', 'bad', '00:AA:00:00:00:02') } }
    Invoke-UwRelay -Answer $answer -Health $h -Now 1234 | Should -Be 2
    @($script:UwFake.Relayed | ForEach-Object { $_.Mac }) | Should -Be @('00:AA:00:00:00:01', '00:AA:00:00:00:02')
    @($script:UwFake.Relayed[0].Ports) | Should -Be @(9, 7)
    @($h.relays).Count | Should -Be 2
    $h.relays[0].sent | Should -Be 12
    $h.relays[0].at | Should -Be 1234
    (Get-UwHealthReport -Health $h -Config $null).relays.Count | Should -Be 2
    Invoke-UwRelay -Answer ([pscustomobject]@{ protocol = 1 }) -Health $h -Now 1 | Should -Be 0
  }

  It 'AC-701-04: a send that fails is noted with its error and logged' {
    Mock Send-UwMagicPacket { throw 'rede inacessível' }
    $h = Read-UwHealthState (Join-Path $TestDrive 'nada.json')
    $answer = [pscustomobject]@{ wake = [pscustomobject]@{ ports = @(9); macs = @('00:AA:00:00:00:01') } }
    [void](Invoke-UwRelay -Answer $answer -Health $h -Now 1)
    $h.relays[0].error | Should -Be 'rede inacessível'
    $h.relays[0].sent | Should -Be 0
    Get-TestLog | Should -Match 'ERRO \[ligar vizinha\] 00:AA:00:00:00:01: rede inacessível'
  }

  It 'the packet is 6 × FF then 16 × the MAC; broadcasts follow the mask' {
    $p = ConvertTo-UwMagicPacket -Mac '00:AA:00:00:00:01'
    $p.Length | Should -Be 102
    @($p[0..5]) | Should -Be @(255, 255, 255, 255, 255, 255)
    @($p[96..101]) | Should -Be @(0, 170, 0, 0, 0, 1)
    { ConvertTo-UwMagicPacket -Mac 'zz' } | Should -Throw
    Get-UwSubnetBroadcast -Address '10.0.3.41' -Mask '255.255.255.0' | Should -Be '10.0.3.255'
    Get-UwSubnetBroadcast -Address '10.0.4.20' -Mask '255.255.254.0' | Should -Be '10.0.5.255'
    Get-UwSubnetBroadcast -Address '10.0.4.20' -Mask '255.255.255.255' | Should -BeNullOrEmpty
    Get-UwSubnetBroadcast -Address 'x' -Mask '255.0.0.0' | Should -BeNullOrEmpty
  }
}

Describe 'Wake-on-LAN kept on (FR-702.1, ADR-065)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    $script:UwFake.Now = Get-SpTime 9 7 0
    $script:H = Read-UwHealthState (Join-Path $TestDrive 'nada.json')
  }

  It 'AC-702-01: what a driver update turned off is turned back on and reported item by item' {
    Mock Get-UwWolState {
      @{
        magic = 'Disabled'; armed = $false; hiberboot = 1
        advanced = @(
          @{ Keyword = '*WakeOnMagicPacket'; Display = 'Wake on Magic Packet'; Value = '0'; ValidDisplay = @('Desativado', 'Ativado'); ValidRegistry = @('0', '1') },
          @{ Keyword = 'S5WakeOnLan'; Display = 'Shutdown Wake-On-Lan'; Value = '1'; ValidDisplay = @('Disabled', 'Enabled'); ValidRegistry = @('0', '1') },
          @{ Keyword = '*EEE'; Display = 'Energy Efficient Ethernet'; Value = '1'; ValidDisplay = @('Off', 'On'); ValidRegistry = @('0', '1') }
        )
      }
    }
    $w = Invoke-UwWolCheck -Trigger 'boot' -Health $script:H -Now 5000 -Boot 77
    $states = @{}
    foreach ($i in $w.items) { $states[$i.item] = $i.state }
    $states.magic_packet | Should -Be 'fixed'
    $states.device_wake | Should -Be 'fixed'
    $states.fast_startup | Should -Be 'fixed'
    $states.advanced_magic | Should -Be 'fixed'
    $states.advanced_s5 | Should -Be 'ok'
    $states.advanced_eee | Should -Be 'fixed'
    @($script:UwFake.WolSets | ForEach-Object { "$($_.Item) $($_.Keyword)=$($_.Value)".Trim() }) |
      Should -Be @('magic_packet =', 'device_wake =', 'fast_startup =', 'advanced *WakeOnMagicPacket=1', 'advanced *EEE=0')
    $w.adapter | Should -Be 'Intel(R) Ethernet Connection I219-LM'
    $script:H.wolBoot | Should -Be 77
    Get-TestLog | Should -Match 'religado: magic_packet, device_wake, fast_startup, advanced_magic, advanced_eee'
    (Get-UwHealthReport -Health $script:H -Config $null).wol.trigger | Should -Be 'boot'
  }

  It 'AC-702-01: a setting that cannot be changed is "failed" with the reason and an error for the hub; no wired adapter is an error too' {
    $script:UwHealthRef = $script:H
    Mock Get-UwWolState { @{ magic = 'Disabled'; armed = $true; hiberboot = 0; advanced = @() } }
    Mock Set-UwWolSetting { throw 'Acesso negado' }
    $w = Invoke-UwWolCheck -Trigger 'periodic' -Health $script:H -Now 5000
    ($w.items | Where-Object { $_.item -eq 'magic_packet' }).state | Should -Be 'failed'
    ($w.items | Where-Object { $_.item -eq 'magic_packet' }).detail | Should -Be 'Acesso negado'
    ($w.items | Where-Object { $_.item -eq 'advanced_eee' }).state | Should -Be 'unsupported'
    @($script:H.pendingErrors | ForEach-Object { $_.where }) | Should -Contain 'ligar pela rede'

    Mock Get-UwWolAdapter { $null }
    $w = Invoke-UwWolCheck -Trigger 'periodic' -Health $script:H -Now 6000
    $w.adapter | Should -BeNullOrEmpty
    Get-TestLog | Should -Match 'nenhuma placa de rede com fio'
    $script:UwHealthRef = $null
  }

  It 'checks at start-up (new boot time), every 6 hours and right before a shutdown' {
    $script:H.wolBoot = 10
    $script:H.wolAt = 1000
    Test-UwWolDue -Health $script:H -Boot 11 -Now 2000 | Should -Be 'boot'
    Test-UwWolDue -Health $script:H -Boot 10 -Now 2000 | Should -BeNullOrEmpty
    Test-UwWolDue -Health $script:H -Boot 10 -Now (1000 + 6 * 3600000) | Should -Be 'periodic'

    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    $state = Read-UwState (Get-UwPathSet).State
    $job = @{
      Kind = 'order'; Order = 'c1b2c3d4-0000-4000-8000-000000000009'; Occurrence = $null; Action = 'shutdown'; At = (Get-SpTime 9 7 1); PlannedAt = $null
      Policy = [pscustomobject]@{ warningMinutes = 1; allowPostpone = $false; postponeMax = 0; postponeMinutes = 5 }
      WasAsleep = $false; LateMinutes = $null
    }
    $h = Read-UwHealthState (Join-Path $TestDrive 'outro.json')
    $r = Invoke-UwExecution -Job $job -State $state -Messages $script:UwDefaultMessages -Poll {} -Freeze @{ state = 'none' } -Health $h -KeepWol $true
    $r.outcome | Should -Be 'done'
    $h.wol.trigger | Should -Be 'before_shutdown'
  }
}

Describe 'Contract of the 1.8.0 health (spec §6f)' {
  It 'the health report has the fields of the shared 1.8.0 fixture, item by item' {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    $script:UwFake.Now = Get-SpTime 9 7 0
    $fx = Get-UwFixture 'checkin-health-v18.json'
    $h = Read-UwHealthState (Join-Path $TestDrive 'nada.json')
    $script:UwHealthRef = $h
    Write-UwLog -Level error -Where 'desligar' -Message 'x'
    $script:UwHealthRef = $null
    [void](Invoke-UwRelay -Answer ([pscustomobject]@{ wake = [pscustomobject]@{ ports = @(9); macs = @('00:AA:00:00:00:01') } }) -Health $h -Now 1)
    [void](Invoke-UwWolCheck -Trigger 'boot' -Health $h -Now 1)
    $state = @{ watch = [ordered]@{ id = $null; action = 'shutdown'; at = 0L; boot = 5L; attempts = 0 } }
    Mock Invoke-UwShutdown { 0 }
    [void](Invoke-UwWatchdog -State $state -Boot 5L -Now (10 * $script:MIN) -Health $h)
    $report = Get-UwHealthReport -Health $h -Config $null -Hibernate @{ enabled = $false; afterMinutes = 0 }
    $json = ConvertTo-Json -InputObject $report -Depth 10 | ConvertFrom-Json
    ($json.PSObject.Properties.Name | Sort-Object) | Should -Be ($fx.PSObject.Properties.Name | Sort-Object)
    foreach ($k in 'relays', 'escalations', 'errors') {
      ($json.$k[0].PSObject.Properties.Name | Sort-Object) | Should -Be ($fx.$k[0].PSObject.Properties.Name | Sort-Object)
    }
    ($json.wol.PSObject.Properties.Name | Sort-Object) | Should -Be ($fx.wol.PSObject.Properties.Name | Sort-Object)
    ($json.wol.items[0].PSObject.Properties.Name | Sort-Object) | Should -Be ($fx.wol.items[0].PSObject.Properties.Name | Sort-Object)
  }
}

Describe 'Agent log and errors for the hub (FR-704.3, ADR-066)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    $script:UwFake.Now = Get-SpTime 9 7 0
  }

  It 'AC-704-03: errors go to agent.log and, the last 10, to the next check-in; a full log becomes agent.log.1' {
    $h = Read-UwHealthState (Join-Path $TestDrive 'nada.json')
    $script:UwHealthRef = $h
    for ($i = 1; $i -le 12; $i++) { Write-UwLog -Level error -Where 'antivirus' -Message "falha $i" }
    Write-UwLog -Where 'desligar' -Message 'só informação'
    $log = Get-TestLog
    $log | Should -Match '2026-11-09T10:00:00Z ERRO \[antivirus\] falha 12'
    $log | Should -Match 'INFO \[desligar\] só informação'
    @($h.pendingErrors).Count | Should -Be 10
    $h.pendingErrors[0].message | Should -Be 'falha 3'
    (Get-UwHealthReport -Health $h -Config $null).errors.Count | Should -Be 10

    $script:UwLogMaxBytes = 100
    Write-UwLog -Where 'x' -Message ('a' * 200)
    Write-UwLog -Where 'x' -Message 'novo'
    Test-Path (Join-Path $script:UwDataDir 'agent.log.1') | Should -BeTrue
    $script:UwLogMaxBytes = 512KB
    $script:UwHealthRef = $null
  }

  It 'AC-704-03: the same error is written and sent at most once an hour' {
    $h = Read-UwHealthState (Join-Path $TestDrive 'nada.json')
    $script:UwHealthRef = $h
    Write-UwLog -Level error -Where 'energia' -Message 'powercfg falhou'
    $script:UwFake.Now += 30 * $script:MIN
    Write-UwLog -Level error -Where 'energia' -Message 'powercfg falhou'
    @($h.pendingErrors).Count | Should -Be 1
    ([regex]::Matches((Get-TestLog), 'powercfg falhou')).Count | Should -Be 1
    $script:UwFake.Now += 31 * $script:MIN
    Write-UwLog -Level error -Where 'energia' -Message 'powercfg falhou'
    @($h.pendingErrors).Count | Should -Be 2
    # It survives a restart of the agent (health.json).
    $p = Join-Path $TestDrive 'h.json'
    Save-UwHealthState $p $h
    (Read-UwHealthState $p).errorSeen['energia|powercfg falhou'] | Should -Be $script:UwFake.Now
    $script:UwHealthRef = $null
  }

  It 'AC-704-03: a hub that took the health clears the events it carried, not the ones that came after' {
    $paths = Get-UwPathSet
    $h = Read-UwHealthState $paths.Health
    $h.hubFeatures['k'] = @('health')
    [void]$h.pendingErrors.Add([ordered]@{ at = 1; where = 'a'; message = 'um' })
    [void]$h.relays.Add([ordered]@{ mac = '00:AA:00:00:00:01'; at = 1; sent = 6; error = $null })
    Save-UwHealthState $paths.Health $h
    Install-UwTestAgent -Hub (New-UwTestHub)
    $script:Sent = $null
    Mock Invoke-UwCheckin {
      $script:Sent = $Health
      # An error logged while the check-in was on the way stays queued.
      [void]$script:UwPollContext.Health.pendingErrors.Add([ordered]@{ at = 2; where = 'b'; message = 'dois' })
      @{ Answer = [pscustomobject]@{ serverTime = 10L }; Hub = [pscustomobject]@{ keyId = 'k' }; Url = 'http://x'; SentAt = 1; ReceivedAt = 2; Features = @('health'); SentHealth = $true }
    }
    Mock Invoke-UwAnswer { , @() }
    $ctx = @{ Paths = $paths; Config = (Read-UwJson $paths.Config $null); State = (Read-UwState $paths.State); Last = $null
      Boot = $null; Freeze = @{ product = $null; state = 'none'; persistent = $false }; Power = @{ sleepAfterMinutes = 0; wakeTimers = 'enabled' }
      Session = @{ loggedOn = $false; sessions = 0 }; Health = $h; Antivirus = $null; Repairs = @()
    }
    $script:UwPollContext = $ctx
    [void](Invoke-UwPoll -Context $ctx)
    @($script:Sent.errors).Count | Should -Be 1
    @($script:Sent.relays).Count | Should -Be 1
    @($h.pendingErrors | ForEach-Object { $_.message }) | Should -Be @('dois')
    @($h.relays).Count | Should -Be 0
  }

  It 'AC-704-03: a hub that stops answering is logged once, and again when it answers' {
    Install-UwTestAgent -Hub (New-UwTestHub)
    [void](Invoke-UwRun)
    $script:UwFake.Now += $script:MIN
    [void](Invoke-UwRun)
    $log = Get-TestLog
    ([regex]::Matches($log, 'nenhum UniWake respondeu')).Count | Should -Be 1
    (Read-UwHealthState (Get-UwPathSet).Health).hubDownSince | Should -Be (Get-SpTime 9 7 0)
  }
}
