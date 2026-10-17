#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# M30 (FR-605, ADR-061): the agent tells how it came back without restarting (suspended or
# hibernated) and reports the hibernation settings; "Impedir suspensão e hibernação" is applied and
# undone. Nothing real is changed: powercfg is reached only through mocked wrappers.

BeforeAll {
  . (Join-Path $PSScriptRoot '..\agent\uniwake-agent.ps1')
  . (Join-Path $PSScriptRoot 'FakeAgent.ps1')
  $script:T0 = [DateTimeOffset]::new(2026, 10, 17, 10, 0, 0, [TimeSpan]::Zero).ToUnixTimeMilliseconds()
}

Describe 'Back without restarting (FR-605.1)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    Mock Get-UwSleepKind { 'hibernate' }
  }

  It 'AC-605-01: a gap with the same boot time is a resume, with the kind from event 42' {
    $beat = $script:T0 - 9 * 3600000
    $r = Get-UwResume -LastBeat $beat -Boot ($beat - 3600000) -Now $script:T0
    $r.from | Should -Be $beat
    $r.to | Should -Be $script:T0
    $r.kind | Should -Be 'hibernate'
    Should -Invoke Get-UwSleepKind -Times 1 -Exactly -ParameterFilter { $SinceMs -eq $beat }
  }

  It 'a restart (boot after the last heartbeat) or a short gap is no resume' {
    $beat = $script:T0 - 9 * 3600000
    Get-UwResume -LastBeat $beat -Boot ($beat + 60000) -Now $script:T0 | Should -BeNullOrEmpty
    Get-UwResume -LastBeat ($script:T0 - 60000) -Boot 1 -Now $script:T0 | Should -BeNullOrEmpty
    Get-UwResume -LastBeat $null -Boot 1 -Now $script:T0 | Should -BeNullOrEmpty
  }

  It 'event 42 TargetState: 5 is hibernation, 2..4 sleep, anything else unknown' {
    ConvertTo-UwSleepKind -TargetState 5 | Should -Be 'hibernate'
    ConvertTo-UwSleepKind -TargetState '4' | Should -Be 'sleep'
    ConvertTo-UwSleepKind -TargetState 6 | Should -Be 'unknown'
    ConvertTo-UwSleepKind -TargetState $null | Should -Be 'unknown'
  }

  It 'the health report carries hibernation facts and the last resume' {
    $health = Read-UwHealthState (Join-Path $script:UwDataDir 'health.json')
    $health.lastResume = [ordered]@{ from = 1; to = 2; kind = 'sleep' }
    $r = Get-UwHealthReport -Health $health -Config $null -Hibernate @{ enabled = $true; afterMinutes = 180 }
    $r.power.hibernateEnabled | Should -BeTrue
    $r.power.hibernateAfterMinutes | Should -Be 180
    $r.power.lastResume.kind | Should -Be 'sleep'
    (Get-UwHealthReport -Health $health -Config $null).power | Should -BeNullOrEmpty
  }
}
