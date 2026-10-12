#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# M18-T02 (FR-302, ADR-043/044): the agent's check-in client — guard against real system calls,
# the request contract, signature checks with the trusted keys, the hub list and applying answers.

BeforeAll {
  . (Join-Path $PSScriptRoot '..\agent\uniwake-agent.ps1')
  . (Join-Path $PSScriptRoot 'FakeAgent.ps1')
  $script:T0 = [DateTimeOffset]::new(2026, 10, 12, 15, 0, 0, [TimeSpan]::Zero).ToUnixTimeMilliseconds() # 12:00 SP

  # The answer the hub sends, from the shared fixture, with this request's time.
  function New-TestAnswer {
    param([long]$ServerTime = $script:T0)
    $a = Get-UwFixture 'checkin-answer.json'
    $a.serverTime = $ServerTime
    $a.orders = @()
    $a.ackReports = @()
    $a.hubs = [pscustomobject]@{ epoch = 0; list = @() }
    $a
  }
  # A hub that signs whatever $script:Answer holds over the nonce of each request.
  function Use-TestHub {
    param($Hub, [scriptblock]$Answer, [int]$Status = 200)
    $script:LastRequests = New-Object System.Collections.ArrayList
    $script:HubFor = @{ Hub = $Hub; Answer = $Answer; Status = $Status }
    Mock Invoke-UwHttp {
      $req = [System.Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
      [void]$script:LastRequests.Add(@{ Url = $Url; Headers = $Headers; Body = $req })
      if ($script:HubFor.Status -ne 200) { return @{ Status = $script:HubFor.Status; Body = [byte[]]@(); Headers = @{} } }
      New-UwSignedResponse -Hub $script:HubFor.Hub -Nonce $req.nonce -Answer (& $script:HubFor.Answer)
    }
  }
}

Describe 'Agent safety net (constitution §5)' {
  It 'refuses every real system call when only loaded by a test' {
    { Get-UwUtcNow } | Should -Throw '*fora do agente*'
    { Invoke-UwShutdown -Arguments '/a' } | Should -Throw '*fora do agente*'
  }

  It 'every system wrapper (the functions that call Assert-UwRealSystem) is faked' {
    $path = Join-Path $PSScriptRoot '..\agent\uniwake-agent.ps1'
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
    $wrappers = $ast.FindAll({
        param($n)
        $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $n.Body.Extent.Text -match 'Assert-UwRealSystem'
      }, $true) | ForEach-Object Name | Where-Object { $_ -ne 'Invoke-UwAgent' } | Sort-Object
    $wrappers | Should -Be ($script:UwAgentSystemFunctions | Sort-Object)
  }
}

Describe 'Check-in client (FR-302.1, ADR-044)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    $script:UwFake.Now = $script:T0
    $script:Hub = New-UwTestHub
    Install-UwTestAgent -Hub $script:Hub
    $script:Config = Read-UwJson (Join-Path $script:UwAgentDir 'config.json')
    $script:Build = @{
      BootTime = 1; Freeze = @{ product = $null; state = 'none'; persistent = $false }
      Power = @{ sleepAfterMinutes = 30; wakeTimers = 'enabled' }; Session = @{ loggedOn = $true; sessions = 1 }
      Reports = @(); AckedOrders = @()
    }
  }

  It 'sends exactly the fields of the contract, with the token, and never a user name' {
    Use-TestHub $script:Hub { New-TestAnswer }
    $r = Invoke-UwCheckin -Config $script:Config -Token 'tok-x' -Request $script:Build
    $r.Answer.serverTime | Should -Be $script:T0
    $sent = $script:LastRequests[0]
    $sent.Url | Should -Be 'http://10.0.0.5:47101/agent/v1/checkin'
    $sent.Headers['Authorization'] | Should -Be 'Bearer tok-x'
    $want = (Get-UwFixture 'checkin-request.json').PSObject.Properties.Name | Sort-Object
    ($sent.Body.PSObject.Properties.Name | Sort-Object) | Should -Be $want
    ($sent.Body.session.PSObject.Properties.Name | Sort-Object) | Should -Be @('loggedOn', 'sessions')
    $sent.Body.reports.GetType().IsArray | Should -BeTrue
  }

  It 'sends queued reports and receipts as flat lists (a nested list would be refused by the hub)' {
    Use-TestHub $script:Hub { New-TestAnswer }
    $paths = Get-UwPathSet
    Add-UwReport $paths.Reports (Format-UwReport -Occurrence 'b1b2c3d4-0000-4000-8000-000000000001' -Action 'shutdown' -Outcome 'done')
    $state = Read-UwState $paths.State
    [void]$state.acked.Add('c1b2c3d4-0000-4000-8000-000000000001')
    $ctx = @{
      Paths = $paths; Config = $script:Config; State = $state; Last = $null; Boot = 1
      Freeze = @{ product = $null; state = 'none'; persistent = $false }
      Power = @{ sleepAfterMinutes = 30; wakeTimers = 'enabled' }; Session = @{ loggedOn = $false; sessions = 0 }
    }
    [void](Invoke-UwPoll -Context $ctx)
    $body = $script:LastRequests[0].Body
    @($body.reports).Count | Should -Be 1
    $body.reports[0].action | Should -Be 'shutdown'
    @($body.ackedOrders) | Should -Be @('c1b2c3d4-0000-4000-8000-000000000001')
    $ctx.Last | Should -Not -BeNullOrEmpty
  }

  It 'ignores an answer signed by another key, replayed for another nonce, or from an untrusted key id' {
    $intruder = New-UwTestHub
    $script:Signer = $intruder
    Mock Invoke-UwHttp {
      $req = [System.Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
      $resp = New-UwSignedResponse -Hub $script:Signer -Nonce $req.nonce -Answer (New-TestAnswer)
      $resp.Headers['x-uniwake-key'] = $script:Hub.KeyId # claims the trusted key
      $resp
    }
    Invoke-UwCheckin -Config $script:Config -Token 't' -Request $script:Build | Should -BeNullOrEmpty

    Mock Invoke-UwHttp { New-UwSignedResponse -Hub $script:Hub -Nonce 'outro-nonce-aaaaaaaaaa' -Answer (New-TestAnswer) }
    Invoke-UwCheckin -Config $script:Config -Token 't' -Request $script:Build | Should -BeNullOrEmpty

    Mock Invoke-UwHttp {
      $req = [System.Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
      New-UwSignedResponse -Hub $script:Signer -Nonce $req.nonce -Answer (New-TestAnswer)
    }
    Invoke-UwCheckin -Config $script:Config -Token 't' -Request $script:Build | Should -BeNullOrEmpty
  }

  It 'tries the next hub when one is off; reports a refused token; returns nothing when no hub answers' {
    $second = New-UwTestHub -Url 'http://10.0.0.6:47101' -InstanceId '1e1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b'
    $config = [pscustomobject]@{ protocol = 1; epoch = 0; hubs = @($script:Hub.Entry, $second.Entry) }
    $script:Second = $second
    Mock Invoke-UwHttp {
      if ($Url -like 'http://10.0.0.5*') { throw 'desligado' }
      $req = [System.Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
      New-UwSignedResponse -Hub $script:Second -Nonce $req.nonce -Answer (New-TestAnswer)
    }
    (Invoke-UwCheckin -Config $config -Token 't' -Request $script:Build).Url | Should -Be 'http://10.0.0.6:47101'

    Use-TestHub $script:Hub { New-TestAnswer } -Status 401
    (Invoke-UwCheckin -Config $script:Config -Token 't' -Request $script:Build).Unauthorized | Should -BeTrue

    Mock Invoke-UwHttp { throw 'desligado' }
    Invoke-UwCheckin -Config $script:Config -Token 't' -Request $script:Build | Should -BeNullOrEmpty

    # Plan §15.7: at most 3 attempts per run, whatever the size of the team.
    $many = @(1..5 | ForEach-Object { [pscustomobject]@{ instanceId = $null; urls = @("http://10.0.0.1$($_):47101"); keyId = 'k'; publicKey = $script:Hub.Entry.publicKey } })
    $big = [pscustomobject]@{ protocol = 1; epoch = 0; hubs = $many }
    Mock Invoke-UwHttp { throw 'desligado' }
    Invoke-UwCheckin -Config $big -Token 't' -Request $script:Build | Should -BeNullOrEmpty
    Should -Invoke Invoke-UwHttp -Times 3 -Exactly -ParameterFilter { $Url -like 'http://10.0.0.1*' }
  }

  It 'keeps the hub that answered first in the list; ignores lists of an older key epoch' {
    $other = New-UwTestHub -Url 'http://10.0.0.6:47101' -InstanceId '1e1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b'
    $cfg = [pscustomobject]@{ protocol = 1; epoch = 2; hubs = @($script:Hub.Entry) }
    $older = Merge-UwHubList -Config $cfg -Used $script:Hub.Entry -Hubs ([pscustomobject]@{ epoch = 1; list = @($other.Entry) })
    $older.epoch | Should -Be 2
    @($older.hubs).Count | Should -Be 1
    $newer = Merge-UwHubList -Config $cfg -Used $script:Hub.Entry -Hubs ([pscustomobject]@{ epoch = 3; list = @($other.Entry) })
    @($newer.hubs | ForEach-Object keyId) | Should -Be @($script:Hub.KeyId, $other.KeyId)
    $newer.epoch | Should -Be 3
  }
}

Describe 'Applying an answer (FR-302..304)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    $script:UwFake.Now = $script:T0
    $script:Hub = New-UwTestHub
    Install-UwTestAgent -Hub $script:Hub
    $script:Paths = Get-UwPathSet
    $script:Config = Read-UwJson $script:Paths.Config
  }

  It 'sets the clock offset, drops acknowledged reports, keeps orders until done and acknowledges them' {
    Add-UwReport $script:Paths.Reports (Format-UwReport -Occurrence 'b1b2c3d4-0000-4000-8000-000000000001' -Action 'shutdown' -Outcome 'done')
    $queued = (Read-UwReportQueue $script:Paths.Reports)[0].uuid
    $answer = New-TestAnswer -ServerTime ($script:T0 + 600000) # the hub is 10 min ahead
    $answer.ackReports = @($queued)
    $answer.orders = @([pscustomobject]@{ uuid = 'c1b2c3d4-0000-4000-8000-000000000001'; action = 'shutdown'; warningMinutes = 1; allowPostpone = $false; postponeMax = 0; postponeMinutes = 5 })
    $state = Read-UwState $script:Paths.State
    $result = @{ Answer = $answer; Hub = $script:Hub.Entry; Url = $script:Hub.Url; SentAt = $script:T0 - 1000; ReceivedAt = $script:T0 + 1000 }
    [void](Invoke-UwAnswer -Result $result -State $state -Paths $script:Paths -Config $script:Config)
    $state.offsetMs | Should -Be 600000
    @(Read-UwReportQueue $script:Paths.Reports).Count | Should -Be 0
    @($state.orders).Count | Should -Be 1
    @($state.acked) | Should -Be @('c1b2c3d4-0000-4000-8000-000000000001')
    # The same order delivered again (by another hub) is not added twice; once done it is ignored.
    [void](Invoke-UwAnswer -Result $result -State $state -Paths $script:Paths -Config $script:Config -SentAcks @('c1b2c3d4-0000-4000-8000-000000000001'))
    @($state.orders).Count | Should -Be 1
    @($state.acked).Count | Should -Be 1 # sent receipts are dropped, the repeated order re-acknowledged
  }

  It 'a cancel removes a pending order and reports it cancelled' {
    $state = Read-UwState $script:Paths.State
    [void]$state.orders.Add([pscustomobject]@{ uuid = 'c1b2c3d4-0000-4000-8000-000000000009'; action = 'restart'; warningMinutes = 1; allowPostpone = $false; postponeMax = 0; postponeMinutes = 5 })
    $answer = New-TestAnswer
    $answer.orders = @([pscustomobject]@{ uuid = 'd1b2c3d4-0000-4000-8000-000000000001'; action = 'cancel'; cancels = 'c1b2c3d4-0000-4000-8000-000000000009' })
    $result = @{ Answer = $answer; Hub = $script:Hub.Entry; Url = $script:Hub.Url; SentAt = $script:T0; ReceivedAt = $script:T0 }
    $out = Invoke-UwAnswer -Result $result -State $state -Paths $script:Paths -Config $script:Config
    @($state.orders).Count | Should -Be 0
    $out[0].outcome | Should -Be 'cancelled'
    $out[0].order | Should -Be 'c1b2c3d4-0000-4000-8000-000000000009'
    $state.doneIds.ContainsKey('c1b2c3d4-0000-4000-8000-000000000009') | Should -BeTrue
  }

  It 'stores a new agenda and wakes the PC before each future item; writes a rotated token' {
    $state = Read-UwState $script:Paths.State
    $answer = New-TestAnswer -ServerTime ([long](Get-UwFixture 'checkin-answer.json').agenda.window.from)
    $answer.newToken = 'novo-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $result = @{ Answer = $answer; Hub = $script:Hub.Entry; Url = $script:Hub.Url; SentAt = $answer.serverTime; ReceivedAt = $answer.serverTime }
    [void](Invoke-UwAnswer -Result $result -State $state -Paths $script:Paths -Config $script:Config)
    $state.agendaVersion | Should -Be $answer.agenda.version
    (Read-UwJson $script:Paths.Agenda).items.Count | Should -Be $answer.agenda.items.Count
    $first = [long]$answer.agenda.items[0].at
    $script:UwFake.WakeTriggers[0] | Should -Be ($first - 5 * 60000 - 60000)
    [System.IO.File]::ReadAllText($script:Paths.Token) | Should -Be 'novo-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    # The same version again does not rewrite the wake task.
    $script:UwFake.WakeTriggers = $null
    [void](Invoke-UwAnswer -Result $result -State $state -Paths $script:Paths -Config $script:Config)
    $script:UwFake.WakeTriggers | Should -BeNullOrEmpty
  }

  It 'self-update replaces a script only when the downloaded bytes match the signed hash' {
    $path = Join-Path $script:UwAgentDir 'uniwake-aviso.ps1'
    [System.IO.File]::WriteAllText($path, 'velho')
    $good = [System.Text.Encoding]::UTF8.GetBytes('novo')
    $script:Served = $good
    Mock Invoke-UwHttp { @{ Status = 200; Body = $script:Served; Headers = @{} } }
    $refs = [pscustomobject]@{ 'uniwake-aviso.ps1' = [pscustomobject]@{ version = '1.3.1'; sha256 = (Get-UwSha256Hex -Bytes $good) } }
    $script:Served = [System.Text.Encoding]::UTF8.GetBytes('adulterado')
    Sync-UwScript -Scripts $refs -HubUrl $script:Hub.Url
    [System.IO.File]::ReadAllText($path) | Should -Be 'velho'
    $script:Served = $good
    Sync-UwScript -Scripts $refs -HubUrl $script:Hub.Url
    [System.IO.File]::ReadAllText($path) | Should -Be 'novo'
  }
}

Describe 'Power plan facts in the check-in (owner Q-3)' {
  It 'reports the AC sleep minutes and the wake-timer state, read by position' {
    $lines = @('      Configuração Mínima Possível: 0x00000000', '    Índice CA Atual: 0x00000708', '    Índice CC Atual: 0x00000000')
    $info = ConvertTo-UwPowerInfo -Sleep (ConvertFrom-UwPowercfgOutput -Lines $lines) -Timers @{ Ac = 2; Dc = 0 }
    $info.sleepAfterMinutes | Should -Be 30
    $info.wakeTimers | Should -Be 'important_only'
    (ConvertTo-UwPowerInfo -Sleep @{ Ac = 0; Dc = 0 } -Timers $null).sleepAfterMinutes | Should -Be 0
    (ConvertTo-UwPowerInfo -Sleep $null -Timers $null).wakeTimers | Should -Be 'unknown'
  }
}
