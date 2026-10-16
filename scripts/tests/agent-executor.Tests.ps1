#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# M18-T03 (FR-303, FR-304.3-.5, ADR-045): the agent's local agenda and execution — the hub off,
# the explicit window, boot and sleep rules, the clock offset, cancel during a warning. Times are
# São Paulo (UTC-3): item at Monday 12 Oct 2026 22:40.

BeforeAll {
  . (Join-Path $PSScriptRoot '..\agent\uniwake-agent.ps1')
  . (Join-Path $PSScriptRoot 'FakeAgent.ps1')
  $script:MIN = 60000L
  # São Paulo local time on day d of October 2026 → UTC ms.
  function Get-SpTime([int]$d, [int]$h, [int]$m = 0) {
    [DateTimeOffset]::new(2026, 10, $d, 0, 0, 0, [TimeSpan]::Zero).AddHours($h + 3).AddMinutes($m).ToUnixTimeMilliseconds()
  }
  $script:At = Get-SpTime 12 22 40
  $script:Occ = '6f1d2a3b-4c5d-5e6f-8a7b-000000000012'

  function Write-TestAgenda {
    param([long[]]$Wakes = @(), [long]$From = (Get-SpTime 12 12), [long]$To = (Get-SpTime 26 12), [long]$At = $script:At)
    Save-UwJson (Get-UwPathSet).Agenda ([ordered]@{
        version = 'aaaaaaaaaaaaaaaa'; window = [ordered]@{ from = $From; to = $To }
        items = @([ordered]@{ occurrence = $script:Occ; at = $At; action = 'shutdown'; warningMinutes = 5; allowPostpone = $true; postponeMax = 2; postponeMinutes = 15 })
        nextWakes = @($Wakes)
      })
  }
  function Set-TestHeartbeat([long]$At) { Save-UwJson (Get-UwPathSet).Heartbeat ([ordered]@{ at = $At }) }
  function Get-TestQueue { @(Read-UwReportQueue (Get-UwPathSet).Reports) }
}

Describe 'Local agenda (FR-303, ADR-045)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    Install-UwTestAgent -Hub (New-UwTestHub)
    # shutdown.exe records the arguments and the (fake) time it was called.
    $script:Calls = New-Object System.Collections.ArrayList
    Mock Invoke-UwShutdown { [void]$script:Calls.Add(@{ Args = ($Arguments -join ' '); At = $script:UwFake.Now }); 0 }
  }

  It 'AC-303-02: with the hub unreachable since 21:20, the PC shuts down at 22:40 with the warning and reports it later' {
    Write-TestAgenda
    Set-TestHeartbeat (Get-SpTime 12 22 34)
    $script:UwFake.Now = Get-SpTime 12 22 35
    Invoke-UwRun | Should -Be 0
    $script:Calls.Count | Should -Be 1
    $script:Calls[0].Args | Should -BeLike '/s /t 30 /c Este computador será desligado às * Salve seus arquivos*'
    $script:Calls[0].At | Should -Be ($script:At - 30000)
    $q = @(Get-TestQueue)
    $q.Count | Should -Be 1
    $q[0].outcome | Should -Be 'done'
    $q[0].occurrence | Should -Be $script:Occ
    # The hub is back the next day: the queued report goes in the check-in.
    $hub = New-UwTestHub
    Install-UwTestAgent -Hub $hub
    $script:Seen = $null
    $script:H = $hub
    Mock Invoke-UwHttp {
      $script:Seen = [System.Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
      throw 'só olhando'
    }
    $script:UwFake.Now = Get-SpTime 13 17 41
    [void](Invoke-UwRun)
    $script:Seen.reports[0].occurrence | Should -Be $script:Occ
  }

  It 'AC-303-03: an agenda whose window ended runs nothing, even an item listed after it' {
    Write-TestAgenda -From (Get-SpTime 1 12) -To (Get-SpTime 5 12) # vacation: the hub was off for a week
    Set-TestHeartbeat (Get-SpTime 12 22 34)
    $script:UwFake.Now = Get-SpTime 12 22 35
    Invoke-UwRun | Should -Be 0
    $script:Calls.Count | Should -Be 0
    @(Get-TestQueue).Count | Should -Be 0
  }

  It 'AC-303-04: asleep through 22:35, woken at 22:55 → shuts down with a fresh warning; at 23:50 or after the next wake → skipped' {
    $state = Read-UwState (Get-UwPathSet).State
    $agenda = [pscustomobject]@{
      window = [pscustomobject]@{ from = (Get-SpTime 12 12); to = (Get-SpTime 26 12) }; nextWakes = @((Get-SpTime 13 7))
      items = @([pscustomobject]@{ occurrence = $script:Occ; at = $script:At; warningMinutes = 5 })
    }
    $late = Get-UwDueItem -Agenda $agenda -State $state -Now (Get-SpTime 12 22 55) -BootTime (Get-SpTime 12 7) -LastHeartbeat (Get-SpTime 12 22 0)
    $late.Kind | Should -Be 'run'
    $late.WasAsleep | Should -BeTrue
    $late.LateMinutes | Should -Be 15
    $tooLate = Get-UwDueItem -Agenda $agenda -State $state -Now (Get-SpTime 12 23 50) -BootTime (Get-SpTime 12 7) -LastHeartbeat (Get-SpTime 12 22 0)
    $tooLate.Kind | Should -Be 'skip'
    $tooLate.Reason | Should -Be 'late_wake'
    $tooLate.LateMinutes | Should -Be 70
    $agenda.nextWakes = @((Get-SpTime 12 22 50))
    (Get-UwDueItem -Agenda $agenda -State $state -Now (Get-SpTime 12 22 55) -BootTime (Get-SpTime 12 7) -LastHeartbeat (Get-SpTime 12 22 0)).Kind | Should -Be 'skip'

    # End to end: the late run gives the user a full warning; the skipped one is reported in pt-BR.
    Write-TestAgenda -Wakes @((Get-SpTime 13 7))
    Set-TestHeartbeat (Get-SpTime 12 22 0)
    Mock Get-UwBootTime { Get-SpTime 12 7 }
    $script:UwFake.Now = Get-SpTime 12 22 55
    [void](Invoke-UwRun)
    $script:Calls[0].At | Should -Be ((Get-SpTime 12 23 0) - 30000)
    @(Get-TestQueue)[0].wasAsleep | Should -BeTrue
    @(Get-TestQueue)[0].lateMinutes | Should -Be 15

    Remove-Item (Get-UwPathSet).State, (Get-UwPathSet).Reports
    $script:Calls.Clear()
    Set-TestHeartbeat (Get-SpTime 12 22 0)
    $script:UwFake.Now = Get-SpTime 12 23 50
    [void](Invoke-UwRun)
    $script:Calls.Count | Should -Be 0
    @(Get-TestQueue)[0].detail | Should -Be 'pulado: acordou 70 min após o horário'
    @(Get-TestQueue)[0].reason | Should -Be 'late_wake'
  }

  It 'AC-303-05: a PC turned on after 22:40 is never shut down by that item' {
    Write-TestAgenda
    Mock Get-UwBootTime { Get-SpTime 12 23 10 }
    Set-TestHeartbeat (Get-SpTime 12 23 11)
    $script:UwFake.Now = Get-SpTime 12 23 12
    [void](Invoke-UwRun)
    $script:Calls.Count | Should -Be 0
    @(Get-TestQueue)[0].reason | Should -Be 'was_off'
    @(Get-TestQueue)[0].detail | Should -Be 'máquina estava desligada'
    # And never later either.
    $script:UwFake.Now = Get-SpTime 12 23 13
    [void](Invoke-UwRun)
    @(Get-TestQueue).Count | Should -Be 1
  }

  It 'AC-303-06: with the PC clock 10 min fast, the item runs at 22:40 hub time' {
    Write-TestAgenda
    $paths = Get-UwPathSet
    $state = Read-UwState $paths.State
    $state.offsetMs = -10 * $script:MIN # hub time = local time - 10 min (measured at the last check-in)
    Save-UwState $paths.State $state (Get-SpTime 12 22 0)
    Set-TestHeartbeat ((Get-SpTime 12 22 44))
    $script:UwFake.Now = (Get-SpTime 12 22 45) # local clock; the hub's 22:35
    [void](Invoke-UwRun)
    $script:Calls[0].At | Should -Be ($script:At + 10 * $script:MIN - 30000) # local 22:49:30 = hub 22:39:30
  }

  It 'never runs the same item twice, even if the run is interrupted during the warning' {
    Write-TestAgenda
    Set-TestHeartbeat (Get-SpTime 12 22 34)
    $script:UwFake.Now = Get-SpTime 12 22 35
    Mock Invoke-UwShutdown { throw 'energia caiu' }
    { Invoke-UwRun } | Should -Throw
    $script:Calls.Clear()
    Mock Invoke-UwShutdown { [void]$script:Calls.Add(@{ Args = ($Arguments -join ' '); At = $script:UwFake.Now }); 0 }
    $script:UwFake.Now = Get-SpTime 12 22 41
    [void](Invoke-UwRun)
    $script:Calls.Count | Should -Be 0
  }
}

Describe 'Orders and cancel (FR-304.4, FR-305)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    Install-UwTestAgent -Hub (New-UwTestHub)
    $script:Calls = New-Object System.Collections.ArrayList
    Mock Invoke-UwShutdown { [void]$script:Calls.Add(@{ Args = ($Arguments -join ' '); At = $script:UwFake.Now }); 0 }
    $script:UwFake.Now = Get-SpTime 12 18
  }

  It 'AC-304-04: a cancel during the native warning runs shutdown /a and reports nothing more' {
    Mock Get-UwSessionInfo { @{ loggedOn = $true; sessions = 1 } } # the window never answers → native
    $state = Read-UwState (Get-UwPathSet).State
    $order = 'c1b2c3d4-0000-4000-8000-000000000001'
    $job = @{
      Kind = 'order'; Order = $order; Occurrence = $null; Action = 'restart'; At = (Get-SpTime 12 18 5); PlannedAt = $null
      Policy = [pscustomobject]@{ warningMinutes = 5; allowPostpone = $false; postponeMax = 0; postponeMinutes = 5 }
      WasAsleep = $false; LateMinutes = $null
    }
    $script:St = $state
    $poll = { $script:St.doneIds['c1b2c3d4-0000-4000-8000-000000000001'] = 1 } # the hub sent a cancel
    $r = Invoke-UwExecution -Job $job -State $state -Messages $script:UwDefaultMessages -Poll $poll -Freeze @{ state = 'none' }
    $r | Should -BeNullOrEmpty
    $script:Calls[0].Args | Should -BeLike '/r /t * /c *'
    $script:Calls[1].Args | Should -Be '/a'
  }

  It 'runs a pending order before the agenda, with its own short warning and no postpone' {
    $paths = Get-UwPathSet
    $state = Read-UwState $paths.State
    [void]$state.orders.Add([pscustomobject]@{ uuid = 'c1b2c3d4-0000-4000-8000-000000000002'; action = 'shutdown'; warningMinutes = 1; allowPostpone = $false; postponeMax = 0; postponeMinutes = 5 })
    Save-UwState $paths.State $state $script:UwFake.Now
    Set-TestHeartbeat ($script:UwFake.Now - 60000)
    [void](Invoke-UwRun)
    $script:Calls[0].At | Should -Be ((Get-SpTime 12 18 1) - 30000)
    $after = Read-UwState $paths.State
    @($after.orders).Count | Should -Be 0
    $after.doneIds.ContainsKey('c1b2c3d4-0000-4000-8000-000000000002') | Should -BeTrue
    @(Get-TestQueue)[0].order | Should -Be 'c1b2c3d4-0000-4000-8000-000000000002'
  }

  It 'a failing shutdown.exe is reported as failed with its exit code' {
    Mock Invoke-UwShutdown { 1190 }
    $state = Read-UwState (Get-UwPathSet).State
    $job = @{
      Kind = 'order'; Order = 'c1b2c3d4-0000-4000-8000-000000000003'; Occurrence = $null; Action = 'shutdown'; At = (Get-SpTime 12 18 1); PlannedAt = $null
      Policy = [pscustomobject]@{ warningMinutes = 1; allowPostpone = $false; postponeMax = 0; postponeMinutes = 5 }
      WasAsleep = $false; LateMinutes = $null
    }
    $r = Invoke-UwExecution -Job $job -State $state -Messages $script:UwDefaultMessages -Poll {} -Freeze @{ state = 'none' }
    $r.outcome | Should -Be 'failed'
    $r.detail | Should -Be 'shutdown.exe saiu com código 1190'
  }
}

Describe 'One execution per run id: agenda and pushed order (v1.6, ADR-053)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    Install-UwTestAgent -Hub (New-UwTestHub)
    $script:Calls = New-Object System.Collections.ArrayList
    Mock Invoke-UwShutdown { [void]$script:Calls.Add(@{ Args = ($Arguments -join ' '); At = $script:UwFake.Now }); 0 }
    $script:Order = 'c1b2c3d4-0000-4000-8000-0000000000aa'
    $script:Pushed = [pscustomobject]@{
      uuid = $script:Order; action = 'shutdown'; occurrence = $script:Occ; plannedAt = $script:At
      warningMinutes = 5; allowPostpone = $true; postponeMax = 2; postponeMinutes = 15
    }
  }

  It 'AC-501-03: the order arrives first: it runs, reports both ids and T, and the agenda item never runs' {
    Write-TestAgenda
    $paths = Get-UwPathSet
    $state = Read-UwState $paths.State
    [void]$state.orders.Add($script:Pushed)
    Save-UwState $paths.State $state (Get-SpTime 12 22 34)
    Set-TestHeartbeat (Get-SpTime 12 22 33)
    $script:UwFake.Now = Get-SpTime 12 22 34
    [void](Invoke-UwRun)
    $script:Calls.Count | Should -Be 1
    $report = @(Get-TestQueue)[0]
    $report.occurrence | Should -Be $script:Occ
    $report.order | Should -Be $script:Order
    $report.plannedAt | Should -Be $script:At
    # The agenda's item for the same occurrence is handled: the next runs do nothing.
    $script:UwFake.Now = Get-SpTime 12 22 36
    Set-TestHeartbeat (Get-SpTime 12 22 35)
    [void](Invoke-UwRun)
    $script:Calls.Count | Should -Be 1
  }

  It 'AC-501-03: the agenda ran first: the late order is settled as already_done and never runs' {
    $paths = Get-UwPathSet
    $state = Read-UwState $paths.State
    $state.doneIds[$script:Occ] = Get-SpTime 12 22 35 # the agenda item ran (marked before running)
    $answer = Get-UwFixture 'checkin-answer.json'
    $answer.orders = @($script:Pushed)
    $answer.ackReports = @()
    $answer.hubs = [pscustomobject]@{ epoch = 0; list = @() }
    $answer.serverTime = Get-SpTime 12 22 37
    $hub = New-UwTestHub
    $result = @{ Answer = $answer; Hub = $hub.Entry; Url = $hub.Url; SentAt = $answer.serverTime; ReceivedAt = $answer.serverTime }
    $out = @(Invoke-UwAnswer -Result $result -State $state -Paths $paths -Config (Read-UwJson $paths.Config))
    @($state.orders).Count | Should -Be 0
    $out.Count | Should -Be 1
    $out[0].outcome | Should -Be 'skipped'
    $out[0].reason | Should -Be 'already_done'
    $out[0].occurrence | Should -Be $script:Occ
    $out[0].order | Should -Be $script:Order
    @($state.acked) | Should -Contain $script:Order
    $script:Calls.Count | Should -Be 0
  }
}
