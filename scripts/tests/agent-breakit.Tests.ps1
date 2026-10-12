#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# M18-D break-it pass for the lab-PC scripts: tampered and corrupted files, links in the users'
# folder, folders users can write, floods of answers, a full report queue.

BeforeAll {
  . (Join-Path $PSScriptRoot '..\agent\uniwake-agent.ps1')
  . (Join-Path $PSScriptRoot 'FakeAgent.ps1')
}

Describe 'M18-D: the real agent folder check (no mocks)' {
  It 'a folder where a user has write access fails the agent folder check (the agent refuses it)' {
    $dir = Join-Path $TestDrive ([guid]::NewGuid())
    New-Item -ItemType Directory -Path $dir | Out-Null
    # The real check (read-only on a temporary folder): the current user's own rights count as "users".
    $script:UwRealSystem = $true
    try {
      Test-UwAgentFolder -Path $dir | Should -BeFalse
    } finally {
      $script:UwRealSystem = $false
    }
  }
}

Describe 'M18-D: folders users could write' {
  BeforeEach { Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid())) }

  It 'a persistent folder that fails the check is ignored: the agenda stays in the agent folder' {
    Install-UwTestAgent -Hub (New-UwTestHub)
    $persistent = Join-Path $TestDrive ([guid]::NewGuid())
    New-Item -ItemType Directory -Path $persistent | Out-Null
    $cfgPath = Join-Path $script:UwAgentDir 'config.json'
    $cfg = Read-UwJson $cfgPath
    $cfg.persistentPath = $persistent
    Save-UwJson $cfgPath $cfg
    $script:Persistent = $persistent
    Mock Test-UwAgentFolder { -not ($Path -eq $script:Persistent) }
    $script:UsedAgenda = $null
    Mock Invoke-UwRun { $script:UsedAgenda = (Get-UwPathSet).Agenda; 0 }
    try {
      Invoke-UwAgent | Should -Be 0
    } finally {
      $script:UwRealSystem = $false
      $script:UwIgnorePersistent = $false
    }
    $script:UsedAgenda | Should -Be (Join-Path $script:UwDataDir 'agenda.json')
  }
}

Describe 'M18-D: the users'' answers folder' {
  BeforeEach { Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid())) }

  It 'reads at most the 50 newest answers and skips link folders' {
    $folder = (Get-UwUiPathSet).Response
    for ($i = 0; $i -lt 60; $i++) {
      $f = Join-Path $folder "p$i.json"
      [System.IO.File]::WriteAllText($f, (ConvertTo-Json -Compress @{ requestId = 'r'; responseId = "id$i"; kind = 'postpone' }))
      (Get-Item $f).LastWriteTimeUtc = [DateTime]::UtcNow.AddSeconds($i)
    }
    New-Item -ItemType Junction -Path (Join-Path $folder 'link') -Target $env:SystemRoot | Out-Null
    $seen = @{}
    $got = Read-UwUiResponse -Folder $folder -RequestId 'r' -Seen $seen
    @($got).Count | Should -Be 50
    $seen.ContainsKey('id59') | Should -BeTrue
    $seen.ContainsKey('id0') | Should -BeFalse
  }
}

Describe 'M18-D: corrupted and full local files' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    Install-UwTestAgent -Hub (New-UwTestHub)
    Mock Invoke-UwShutdown { throw 'não deveria desligar' }
    $script:UwFake.Now = 1791766800000
  }

  It 'a half-written agenda or state file does nothing (and never shuts down)' {
    $paths = Get-UwPathSet
    [System.IO.File]::WriteAllText($paths.Agenda, '{"version":"abc","items":[{"occ')
    [System.IO.File]::WriteAllText($paths.State, 'não é json')
    Invoke-UwRun | Should -Be 0
  }

  It 'keeps at most 500 queued reports, dropping the oldest' {
    $paths = Get-UwPathSet
    $many = @(1..500 | ForEach-Object { Format-UwReport -Order "c1b2c3d4-0000-4000-8000-$('{0:000000000000}' -f $_)" -Action 'shutdown' -Outcome 'done' })
    Save-UwJson $paths.Reports $many
    Add-UwReport $paths.Reports (Format-UwReport -Order 'c1b2c3d4-0000-4000-8000-999999999999' -Action 'shutdown' -Outcome 'done')
    $queue = @(Read-UwReportQueue $paths.Reports)
    $queue.Count | Should -Be 500
    $queue[0].order | Should -Be 'c1b2c3d4-0000-4000-8000-000000000002'
    $queue[-1].order | Should -Be 'c1b2c3d4-0000-4000-8000-999999999999'
  }

  It 'an unprepared PC (no token) does nothing and says so with exit code 2' {
    Remove-Item (Join-Path $script:UwAgentDir 'token.txt')
    Invoke-UwRun | Should -Be 2
  }
}
