#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# M29-T02 (FR-603.1, FR-603.2, ADR-059): verified self-update with an outcome for every attempt, and
# the health part of the check-in sent only to hubs that announce it (a v1.5.0 hub refuses it).

BeforeAll {
  . (Join-Path $PSScriptRoot '..\agent\uniwake-agent.ps1')
  . (Join-Path $PSScriptRoot 'FakeAgent.ps1')
  $script:T0 = [DateTimeOffset]::new(2026, 10, 17, 15, 0, 0, [TimeSpan]::Zero).ToUnixTimeMilliseconds()

  function New-TestAnswer {
    param([switch]$WithoutFeatures)
    $a = Get-UwFixture 'checkin-answer.json'
    $a.serverTime = $script:T0
    $a.orders = @()
    $a.ackReports = @()
    $a.hubs = [pscustomobject]@{ epoch = 0; list = @() }
    if ($WithoutFeatures) { $a.PSObject.Properties.Remove('features') }
    $a
  }
  function Use-TestHub {
    param($Hub, [scriptblock]$Answer)
    $script:LastRequests = New-Object System.Collections.ArrayList
    $script:HubFor = @{ Hub = $Hub; Answer = $Answer }
    Mock Invoke-UwHttp {
      $req = [System.Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
      [void]$script:LastRequests.Add(@{ Url = $Url; Body = $req })
      New-UwSignedResponse -Hub $script:HubFor.Hub -Nonce $req.nonce -Answer (& $script:HubFor.Answer)
    }
  }
}

Describe 'Verified self-update (FR-603.2)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    $script:UwFake.Now = $script:T0
    $script:Path = Join-Path $script:UwAgentDir 'uniwake-aviso.ps1'
    [System.IO.File]::WriteAllText($script:Path, 'velho')
    $script:Good = [System.Text.Encoding]::UTF8.GetBytes('novo')
    $script:Refs = [pscustomobject]@{
      'uniwake-aviso.ps1' = [pscustomobject]@{ version = '1.7.0'; sha256 = (Get-UwSha256Hex -Bytes $script:Good) }
    }
    Mock Invoke-UwHttp { @{ Status = 200; Body = $script:Good; Headers = @{} } }
    $script:Health = Read-UwHealthState (Join-Path $script:UwDataDir 'health.json')
  }

  It 'updated: the file is written, read back a moment later and the outcome recorded' {
    $o = Sync-UwScript -Scripts $script:Refs -HubUrl 'http://10.0.0.5:47101' -Health $script:Health
    $o.outcome | Should -Be 'updated'
    $o.file | Should -Be 'uniwake-aviso.ps1'
    [System.IO.File]::ReadAllText($script:Path) | Should -Be 'novo'
    $script:Health.update.outcome | Should -Be 'updated'
  }

  It 'AC-603-02: write_blocked with the antivirus code 225 when Windows refuses the file; nothing left behind' {
    Mock Save-UwScriptContent {
      [System.IO.File]::WriteAllText("$Path.tmp", 'x')
      throw [System.IO.IOException]::new('A operação não foi concluída com êxito porque o arquivo contém um vírus.', -2147024671)
    }
    $o = Sync-UwScript -Scripts $script:Refs -HubUrl 'http://10.0.0.5:47101' -Health $script:Health
    $o.outcome | Should -Be 'write_blocked'
    $o.code | Should -Be 225
    $o.detail | Should -Match 'vírus'
    Test-Path -LiteralPath "$($script:Path).tmp" | Should -BeFalse
    [System.IO.File]::ReadAllText($script:Path) | Should -Be 'velho'
    $script:Health.update.code | Should -Be 225
  }

  It 'AC-603-02: removed_after_write when the file disappears right after it was written' {
    Mock Wait-UwSecond { Remove-Item -LiteralPath $script:Path -Force }
    $o = Sync-UwScript -Scripts $script:Refs -HubUrl 'http://10.0.0.5:47101' -Health $script:Health
    $o.outcome | Should -Be 'removed_after_write'
    $o.code | Should -BeNullOrEmpty
  }

  It 'download_failed and hash_mismatch keep the old file' {
    Mock Invoke-UwHttp { throw 'hub desligado' }
    (Sync-UwScript -Scripts $script:Refs -HubUrl 'http://10.0.0.5:47101').outcome | Should -Be 'download_failed'
    Mock Invoke-UwHttp { @{ Status = 200; Body = [System.Text.Encoding]::UTF8.GetBytes('adulterado'); Headers = @{} } }
    (Sync-UwScript -Scripts $script:Refs -HubUrl 'http://10.0.0.5:47101').outcome | Should -Be 'hash_mismatch'
    [System.IO.File]::ReadAllText($script:Path) | Should -Be 'velho'
  }

  It 'a file that already matches is left alone and leaves no outcome' {
    [System.IO.File]::WriteAllBytes($script:Path, $script:Good)
    Sync-UwScript -Scripts $script:Refs -HubUrl 'http://10.0.0.5:47101' -Health $script:Health | Should -BeNullOrEmpty
    $script:Health.update | Should -BeNullOrEmpty
    Should -Invoke Invoke-UwHttp -Times 0
  }

  It 'reads the Windows error code inside wrapped exceptions' {
    $inner = [System.IO.IOException]::new('vírus', -2147024670)
    Get-UwWin32Code ([System.Exception]::new('fora', $inner)) | Should -Be 226
    Get-UwWin32Code ([System.UnauthorizedAccessException]::new('negado')) | Should -Be 5
    Get-UwWin32Code ([System.Exception]::new('outro')) | Should -BeNullOrEmpty
  }
}

Describe 'Health only for hubs that announce it (FR-603.1)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    $script:UwFake.Now = $script:T0
    $script:Hub = New-UwTestHub
    Install-UwTestAgent -Hub $script:Hub
    $paths = Get-UwPathSet
    $script:Ctx = @{
      Paths = $paths; Config = (Read-UwJson $paths.Config); State = (Read-UwState $paths.State); Last = $null; Boot = 1
      Freeze = @{ product = $null; state = 'none'; persistent = $false }
      Power = @{ sleepAfterMinutes = 30; wakeTimers = 'enabled' }; Session = @{ loggedOn = $false; sessions = 0 }
      Health = (Read-UwHealthState $paths.Health); Repairs = @(); Antivirus = $null
    }
  }

  It 'the antivirus part counts as sent only once a hub that announces health took it' {
    Use-TestHub $script:Hub { New-TestAnswer }
    $script:Ctx.Antivirus = [ordered]@{ products = @(); detections = @() }
    $script:Ctx.AntivirusHash = 'abc'
    [void](Invoke-UwPoll -Context $script:Ctx) # the hub's features are not known yet: no health
    $script:Ctx.Health.avHash | Should -Be ''
    $script:Ctx.Antivirus | Should -Not -BeNullOrEmpty
    [void](Invoke-UwPoll -Context $script:Ctx)
    $script:LastRequests[1].Body.health.antivirus | Should -Not -BeNullOrEmpty
    $script:Ctx.Health.avHash | Should -Be 'abc'
    $script:Ctx.Antivirus | Should -BeNullOrEmpty
  }

  It 'AC-603-01: no health until the hub announces it; then it goes; a hub that stops announcing gets none' {
    $script:Plain = $false
    Use-TestHub $script:Hub { New-TestAnswer -WithoutFeatures:$script:Plain }
    [void](Invoke-UwPoll -Context $script:Ctx)
    $script:LastRequests[0].Body.PSObject.Properties.Name | Should -Not -Contain 'health'
    [void](Invoke-UwPoll -Context $script:Ctx)
    $sent = $script:LastRequests[1].Body.health
    $sent.installLevel | Should -Be 1
    @($sent.repairs).Count | Should -Be 0
    $sent.PSObject.Properties.Name | Should -Contain 'update'
    # The features survive the run (health.json).
    (Read-UwHealthState $script:Ctx.Paths.Health).hubFeatures[$script:Hub.KeyId] | Should -Be @('health')
    # A v1.5.0 hub (no features in its answer) gets no health afterwards.
    $script:Plain = $true
    [void](Invoke-UwPoll -Context $script:Ctx)
    [void](Invoke-UwPoll -Context $script:Ctx)
    $script:LastRequests[3].Body.PSObject.Properties.Name | Should -Not -Contain 'health'
  }
}
