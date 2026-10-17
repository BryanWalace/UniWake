#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# M29-T03 (FR-603.3, FR-603.4, ADR-059): the agent installs its own newer steps (verified copy, repair
# task) and the repair command restores a removed script from that copy or tells the hub.

BeforeAll {
  . (Join-Path $PSScriptRoot '..\agent\uniwake-agent.ps1')
  . (Join-Path $PSScriptRoot 'FakeAgent.ps1')
  $script:T0 = [DateTimeOffset]::new(2026, 10, 17, 15, 0, 0, [TimeSpan]::Zero).ToUnixTimeMilliseconds()

  # Both scripts on disk and the signed hashes of exactly those bytes.
  function Install-TestScript {
    $refs = [ordered]@{}
    foreach ($name in 'uniwake-agent.ps1', 'uniwake-aviso.ps1') {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("# $name conteúdo")
      [System.IO.File]::WriteAllBytes((Join-Path $script:UwAgentDir $name), $bytes)
      $refs[$name] = [pscustomobject]@{ version = '1.7.0'; sha256 = (Get-UwSha256Hex -Bytes $bytes) }
    }
    [pscustomobject]$refs
  }
}

Describe 'Self-install of the newer steps (FR-603.3)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    $script:UwFake.Now = $script:T0
    Install-UwTestAgent -Hub (New-UwTestHub)
    $script:Refs = Install-TestScript
    $script:Paths = Get-UwPathSet
    $script:Health = Read-UwHealthState $script:Paths.Health
  }

  It 'AC-603-03: writes the verified copy and the repair task, records the level, once' {
    Invoke-UwSelfInstall -Scripts $script:Refs -Paths $script:Paths -Health $script:Health -Now $script:T0
    $copy = Join-Path $script:UwAgentDir 'copia'
    foreach ($name in 'uniwake-agent.ps1', 'uniwake-aviso.ps1') {
      Get-UwFileSha256 -Path (Join-Path $copy $name) | Should -Be $script:Refs.$name.sha256
    }
    (Read-UwJson (Join-Path $copy 'manifest.json'))."uniwake-agent.ps1" | Should -Be $script:Refs.'uniwake-agent.ps1'.sha256
    $script:UwFake.RepairTask | Should -Match "copia"
    (Read-UwJson $script:Paths.Config).installLevel | Should -Be 2
    (Read-UwJson $script:Paths.Config).hubs | Should -Not -BeNullOrEmpty # the rest of the config is kept
    $script:UwFake.RepairTask = $null
    Invoke-UwSelfInstall -Scripts $script:Refs -Paths $script:Paths -Health $script:Health -Now ($script:T0 + 7200000)
    $script:UwFake.RepairTask | Should -BeNullOrEmpty
  }

  It 'a frozen machine that lost the task at restart registers it again at once (success is not throttled)' {
    Invoke-UwSelfInstall -Scripts $script:Refs -Paths $script:Paths -Health $script:Health -Now $script:T0
    # Restart of a frozen machine: the config goes back to level 1; health.json is in the kept folder.
    Install-UwTestAgent -Hub (New-UwTestHub)
    $script:UwFake.RepairTask = $null
    Invoke-UwSelfInstall -Scripts $script:Refs -Paths $script:Paths -Health $script:Health -Now ($script:T0 + 5 * 60000)
    $script:UwFake.RepairTask | Should -Not -BeNullOrEmpty
  }

  It 'copies only files that match the signed hashes and keeps a still-valid older copy' {
    Invoke-UwSelfInstall -Scripts $script:Refs -Paths $script:Paths -Health $script:Health -Now $script:T0
    # The live script is changed (not by an update): it is not copied over the good copy.
    [System.IO.File]::WriteAllText((Join-Path $script:UwAgentDir 'uniwake-agent.ps1'), 'alterado')
    Update-UwVerifiedCopy -Scripts $script:Refs
    Get-UwFileSha256 -Path (Join-Path $script:UwAgentDir 'copia\uniwake-agent.ps1') | Should -Be $script:Refs.'uniwake-agent.ps1'.sha256
    (Read-UwJson (Join-Path $script:UwAgentDir 'copia\manifest.json'))."uniwake-agent.ps1" | Should -Be $script:Refs.'uniwake-agent.ps1'.sha256
  }

  It 'a failed task registration keeps the level and is retried at most hourly, never stopping the run' {
    Mock Register-UwRepairTask { throw 'Acesso negado' }
    { Invoke-UwSelfInstall -Scripts $script:Refs -Paths $script:Paths -Health $script:Health -Now $script:T0 } | Should -Throw
    (Read-UwJson $script:Paths.Config).PSObject.Properties.Name | Should -Not -Contain 'installLevel'
    Invoke-UwSelfInstall -Scripts $script:Refs -Paths $script:Paths -Health $script:Health -Now ($script:T0 + 60000)
    Should -Invoke Register-UwRepairTask -Times 1 -Exactly
    { Invoke-UwSelfInstall -Scripts $script:Refs -Paths $script:Paths -Health $script:Health -Now ($script:T0 + 3600000) } | Should -Throw
    Should -Invoke Register-UwRepairTask -Times 2 -Exactly
  }
}

Describe 'The repair command (FR-603.4), run for real in a temporary folder' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    $script:UwFake.Now = $script:T0
    # A hub nobody listens on (loopback, closed port): the alert fails at once.
    Install-UwTestAgent -Hub (New-UwTestHub -Url 'http://127.0.0.1:9')
    $script:Refs = Install-TestScript
    Update-UwVerifiedCopy -Scripts $script:Refs
    $script:Command = Get-UwRepairCommand -AgentDir $script:UwAgentDir
    $script:Agent = Join-Path $script:UwAgentDir 'uniwake-agent.ps1'
    $script:Log = Join-Path $script:UwAgentDir 'repairs.log'
    function Invoke-TestRepair { & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $script:Command }
  }

  It 'AC-603-04: restores a removed script from the copy and leaves the note the agent reports' {
    Remove-Item -LiteralPath $script:Agent -Force
    Invoke-TestRepair
    Get-UwFileSha256 -Path $script:Agent | Should -Be $script:Refs.'uniwake-agent.ps1'.sha256
    $notes = @(Read-UwRepairNote -Path $script:Log)
    $notes.Count | Should -Be 1
    $notes[0].file | Should -Be 'uniwake-agent.ps1'
    $notes[0].reason | Should -Be 'missing'
    $notes[0].outcome | Should -Be 'restored'
  }

  It 'AC-603-04: a changed script is restored too; with the copy gone it notes not_restored and returns' {
    [System.IO.File]::WriteAllText($script:Agent, 'alterado')
    Invoke-TestRepair
    (@(Read-UwRepairNote -Path $script:Log))[0].reason | Should -Be 'changed'
    Remove-Item -LiteralPath $script:Agent -Force
    Remove-Item -LiteralPath (Join-Path $script:UwAgentDir 'copia\uniwake-agent.ps1') -Force
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    Invoke-TestRepair
    $watch.Elapsed.TotalSeconds | Should -BeLessThan 30
    $last = @(Read-UwRepairNote -Path $script:Log)[-1]
    $last.outcome | Should -Be 'not_restored'
    Test-Path -LiteralPath $script:Agent | Should -BeFalse
  }

  It 'does nothing while every script matches its copy' {
    Invoke-TestRepair
    Test-Path -LiteralPath $script:Log | Should -BeFalse
  }
}

Describe 'Registering the real repair task (disposable CI Windows only)' {
  It 'registers "UniWake Reparo" with its triggers and SYSTEM, then removes it' -Skip:($env:GITHUB_ACTIONS -ne 'true') {
    $script:UwRealSystem = $true
    try {
      Register-UwRepairTask -Command (Get-UwRepairCommand -AgentDir (Join-Path $TestDrive 'agent'))
      $t = Get-ScheduledTask -TaskName 'UniWake Reparo'
      @($t.Triggers).Count | Should -Be 2
      $t.Principal.UserId | Should -Be 'SYSTEM'
      $t.Actions[0].Arguments | Should -Match '^-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "'
    } finally {
      $script:UwRealSystem = $false
      Unregister-ScheduledTask -TaskName 'UniWake Reparo' -Confirm:$false -ErrorAction SilentlyContinue
    }
  }
}
