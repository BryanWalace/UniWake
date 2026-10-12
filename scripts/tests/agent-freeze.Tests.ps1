#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# M18-T06 (FR-308, ADR-047): freezing software as the agent reports it, and the agenda kept in a
# folder that survives freezing. Only ADR-047's methods; anything else is "não verificado".

BeforeAll {
  . (Join-Path $PSScriptRoot '..\agent\uniwake-agent.ps1')
  . (Join-Path $PSScriptRoot 'FakeAgent.ps1')
}

Describe 'Freezing detection (FR-308.1, ADR-047)' {
  It 'AC-308-01: each fixture gives ADR-047''s state; unknown cases say "não verificado"' {
    $cases = @(
      @{ Name = 'none'; Facts = @{ Services = @(); Processes = @(); DfcExit = $null; Uwf = $null }; Want = @($null, 'none') }
      @{ Name = 'Deep Freeze frozen'; Facts = @{ Services = @('DFServ'); Processes = @('FrzState2k'); DfcExit = 1; Uwf = $null }; Want = @('deep_freeze', 'frozen') }
      @{ Name = 'Deep Freeze thawed'; Facts = @{ Services = @('DfServEx'); Processes = @(); DfcExit = 0; Uwf = $null }; Want = @('deep_freeze', 'thawed') }
      @{ Name = 'Deep Freeze without DFC.exe'; Facts = @{ Services = @('DFServ'); Processes = @(); DfcExit = $null; Uwf = $null }; Want = @('deep_freeze', 'present_unknown') }
      @{ Name = 'UWF enabled'; Facts = @{ Services = @(); Processes = @(); DfcExit = $null; Uwf = @{ CurrentEnabled = $true; NextEnabled = $true } }; Want = @('uwf', 'frozen') }
      @{ Name = 'UWF disabled at next boot'; Facts = @{ Services = @(); Processes = @(); DfcExit = $null; Uwf = @{ CurrentEnabled = $true; NextEnabled = $false } }; Want = @('uwf', 'frozen') }
      @{ Name = 'UWF off'; Facts = @{ Services = @(); Processes = @(); DfcExit = $null; Uwf = @{ CurrentEnabled = $false; NextEnabled = $false } }; Want = @('uwf', 'thawed') }
      @{ Name = 'Reboot Restore Rx'; Facts = @{ Services = @(); Processes = @('shdserv', 'shield'); DfcExit = $null; Uwf = $null }; Want = @('reboot_restore_rx', 'present_unknown') }
      @{ Name = 'Shadow Defender'; Facts = @{ Services = @(); Processes = @('DefenderDaemon'); DfcExit = $null; Uwf = $null }; Want = @('shadow_defender', 'present_unknown') }
      @{ Name = 'frozen wins over thawed'; Facts = @{ Services = @('DFServ'); Processes = @(); DfcExit = 0; Uwf = @{ CurrentEnabled = $true; NextEnabled = $true } }; Want = @('uwf', 'frozen') }
      @{ Name = 'detection failed'; Facts = @{ Failed = $true }; Want = @($null, 'unverified') }
    )
    foreach ($c in $cases) {
      $r = Resolve-UwFreezeState $c.Facts
      "$($c.Name): $($r.product) $($r.state)" | Should -Be "$($c.Name): $($c.Want[0]) $($c.Want[1])"
    }
  }

  It 'reports the freezing state in every check-in, with the persistent area' {
    $root = Join-Path $TestDrive ([guid]::NewGuid())
    Register-UwFakeAgent -Root $root
    Mock Get-UwFreezeInfo { @{ product = 'deep_freeze'; state = 'frozen' } }
    Install-UwTestAgent -Hub (New-UwTestHub)
    $cfgPath = Join-Path $script:UwAgentDir 'config.json'
    $cfg = Read-UwJson $cfgPath
    $cfg.persistentPath = Join-Path $root 'T\UniWake'
    Save-UwJson $cfgPath $cfg
    $script:Sent = $null
    Mock Invoke-UwHttp { $script:Sent = [System.Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json; throw 'hub desligado' }
    $script:UwFake.Now = 1791766800000
    [void](Invoke-UwRun)
    $script:Sent.freeze.product | Should -Be 'deep_freeze'
    $script:Sent.freeze.state | Should -Be 'frozen'
    $script:Sent.freeze.persistent | Should -BeTrue
  }
}

Describe 'Agenda on a frozen machine (FR-308.4)' {
  It 'AC-308-04: with a persistent path configured, agenda, state and reports live there' {
    $root = Join-Path $TestDrive ([guid]::NewGuid())
    Register-UwFakeAgent -Root $root
    $hub = New-UwTestHub
    Install-UwTestAgent -Hub $hub
    $persistent = Join-Path $root 'T\UniWake'
    $cfgPath = Join-Path $script:UwAgentDir 'config.json'
    $cfg = Read-UwJson $cfgPath
    $cfg.persistentPath = $persistent
    Save-UwJson $cfgPath $cfg
    $paths = Get-UwPathSet
    $paths.Agenda | Should -Be (Join-Path $persistent 'agenda.json')
    $answer = Get-UwFixture 'checkin-answer.json'
    $answer.orders = @()
    $answer.ackReports = @()
    $answer.hubs = [pscustomobject]@{ epoch = 0; list = @() }
    $state = Read-UwState $paths.State
    $result = @{ Answer = $answer; Hub = $hub.Entry; Url = $hub.Url; SentAt = $answer.serverTime; ReceivedAt = $answer.serverTime }
    [void](Invoke-UwAnswer -Result $result -State $state -Paths $paths -Config $cfg)
    Save-UwState $paths.State $state $answer.serverTime
    Add-UwReport $paths.Reports (Format-UwReport -Occurrence 'b1b2c3d4-0000-4000-8000-000000000001' -Action 'shutdown' -Outcome 'done')
    foreach ($f in 'agenda.json', 'state.json', 'reports.json') {
      Test-Path (Join-Path $persistent $f) | Should -BeTrue
      Test-Path (Join-Path $script:UwDataDir $f) | Should -BeFalse
    }
  }
}
