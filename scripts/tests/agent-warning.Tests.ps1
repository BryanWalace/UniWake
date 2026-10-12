#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# M18-T04 (FR-304.1-.3, ADR-046): the warning with "Adiar" — the SYSTEM agent and the user's window
# (uniwake-aviso.ps1) talking only through the ui\ files, the limits enforced by SYSTEM, and the
# native warning when the window does not come up. No window is ever shown here.

BeforeAll {
  . (Join-Path $PSScriptRoot '..\agent\uniwake-agent.ps1')
  . (Join-Path $PSScriptRoot '..\agent\uniwake-aviso.ps1')
  . (Join-Path $PSScriptRoot 'FakeAgent.ps1')
  function Get-SpTime([int]$d, [int]$h, [int]$m = 0) {
    [DateTimeOffset]::new(2026, 10, $d, 0, 0, 0, [TimeSpan]::Zero).AddHours($h + 3).AddMinutes($m).ToUnixTimeMilliseconds()
  }
  $script:At = Get-SpTime 12 22 40
  function New-TestJob([long]$At = $script:At) {
    @{
      Kind = 'item'; Order = $null; Occurrence = '6f1d2a3b-4c5d-5e6f-8a7b-000000000012'; Action = 'shutdown'
      At = $At; PlannedAt = $At; WasAsleep = $false; LateMinutes = $null
      Policy = [pscustomobject]@{ warningMinutes = 5; allowPostpone = $true; postponeMax = 2; postponeMinutes = 15 }
    }
  }
}

Describe 'Warning with "Adiar" (FR-304, ADR-046)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    Mock Get-UwSessionInfo { @{ loggedOn = $true; sessions = 1 } }
    $script:Calls = New-Object System.Collections.ArrayList
    Mock Invoke-UwShutdown { [void]$script:Calls.Add(@{ Args = ($Arguments -join ' '); At = $script:UwFake.Now }); 0 }
    # The window comes up when the task starts: it reads the request and says "alive".
    $script:Seen = $null
    Mock Start-UwWarningTask {
      $script:UwFake.WarningStarted++
      $script:Seen = Read-UwAvisoRequest
      [void](Write-UwAvisoResponse -RequestId $script:Seen.requestId -Kind 'alive')
    }
    $script:UwFake.Now = Get-SpTime 12 22 35
    $script:State = Read-UwState (Get-UwPathSet).State
  }

  It 'AC-304-01: with a user logged on, the warning task gets the message, the time and the postpones left' {
    Mock Wait-UwSecond { $script:UwFake.Now += [long]$Seconds * 1000 }
    [void](Invoke-UwExecution -Job (New-TestJob) -State $script:State -Messages $script:UwDefaultMessages -Poll {} -Freeze @{ state = 'none' })
    $script:UwFake.WarningStarted | Should -Be 1
    $script:Seen.message | Should -Be 'Este computador será desligado às 22:40 pela equipe de TI. Salve seus arquivos: o que não for salvo será perdido. Você pode adiar mais 2 vez(es).'.Replace('22:40', (Format-UwTime $script:At))
    $script:Seen.at | Should -Be $script:At
    $script:Seen.postponesLeft | Should -Be 2
    $script:Seen.postponeMinutes | Should -Be 15
    Format-UwCountdown -AtMs $script:Seen.at -NowMs (Get-SpTime 12 22 35) | Should -Be 'Desliga em 5:00'
    # The request is gone after the shutdown: the window closes.
    Read-UwAvisoRequest | Should -BeNullOrEmpty
  }

  It 'AC-304-02: two postpones then no answer: shutdown at 23:10, reported "adiado 2×"' {
    # The user clicks "Adiar" at 22:36 and 22:52, and once more at 23:00 (no postpones left).
    $script:Clicks = @{ (Get-SpTime 12 22 36) = $false; (Get-SpTime 12 22 52) = $false; (Get-SpTime 12 23 0) = $false }
    Mock Wait-UwSecond {
      $script:UwFake.Now += [long]$Seconds * 1000
      foreach ($k in @($script:Clicks.Keys)) {
        if (-not $script:Clicks[$k] -and $script:UwFake.Now -ge $k) {
          $script:Clicks[$k] = $true
          $req = Read-UwAvisoRequest
          if ($req) { [void](Write-UwAvisoResponse -RequestId $req.requestId -Kind 'postpone') }
        }
      }
    }
    $r = Invoke-UwExecution -Job (New-TestJob) -State $script:State -Messages $script:UwDefaultMessages -Poll {} -Freeze @{ state = 'none' }
    $script:Calls.Count | Should -Be 1
    $script:Calls[0].At | Should -Be ((Get-SpTime 12 23 10) - 30000)
    $r.postpones | Should -Be 2
    $r.outcome | Should -Be 'done'
    $r.nativeWarning | Should -BeFalse
  }

  It 'AC-304-03: when the warning window does not come up, the native warning runs (shutdown /t 300), no postpone' {
    Mock Start-UwWarningTask { throw 'a tarefa não iniciou' }
    $r = Invoke-UwExecution -Job (New-TestJob) -State $script:State -Messages $script:UwDefaultMessages -Poll {} -Freeze @{ state = 'none' }
    $script:Calls[0].Args | Should -BeLike '/s /t 28* /c Este computador será desligado*' # 300 s minus the 20 s wait
    $script:Calls[0].Args | Should -Not -BeLike '*adiar*'
    $r.nativeWarning | Should -BeTrue
    $r.outcome | Should -Be 'done'
  }

  It 'AC-304-05: answers for another request, oversized files and repeated responses change nothing' {
    $folder = (Get-UwUiPathSet).Response
    $script:Injected = $false
    Mock Wait-UwSecond {
      $script:UwFake.Now += [long]$Seconds * 1000
      if (-not $script:Injected) {
        $script:Injected = $true
        $req = Read-UwAvisoRequest
        # A tampered file for another request, a 5 KB one, and the same response id twice.
        [System.IO.File]::WriteAllText((Join-Path $folder 'x.json'), (ConvertTo-Json -Compress @{ requestId = 'outro'; responseId = 'r1'; kind = 'postpone' }))
        [System.IO.File]::WriteAllText((Join-Path $folder 'big.json'), (ConvertTo-Json -Compress @{ requestId = $req.requestId; responseId = 'r2'; kind = 'postpone'; pad = ('x' * 5000) }))
        $dup = ConvertTo-Json -Compress @{ requestId = $req.requestId; responseId = 'r3'; kind = 'postpone' }
        [System.IO.File]::WriteAllText((Join-Path $folder 'a.json'), $dup)
        [System.IO.File]::WriteAllText((Join-Path $folder 'b.json'), $dup)
      }
    }
    $r = Invoke-UwExecution -Job (New-TestJob) -State $script:State -Messages $script:UwDefaultMessages -Poll {} -Freeze @{ state = 'none' }
    $r.postpones | Should -Be 1 # only r3, once
    $script:Calls[0].At | Should -Be ($script:At + 15 * 60000 - 30000)
    # SYSTEM never deletes in the users' folder (ADR-046).
    Test-Path (Join-Path $folder 'x.json') | Should -BeTrue
  }

  It 'without a user logged on there is no window: shutdown /t 30 at T − 30 s' {
    Mock Get-UwSessionInfo { @{ loggedOn = $false; sessions = 0 } }
    $r = Invoke-UwExecution -Job (New-TestJob) -State $script:State -Messages $script:UwDefaultMessages -Poll {} -Freeze @{ state = 'none' }
    $script:UwFake.WarningStarted | Should -Be 0
    $script:Calls[0].Args | Should -BeLike '/s /t 30 /c *'
    $script:Calls[0].At | Should -Be ($script:At - 30000)
    $r.userLoggedOn | Should -BeFalse
  }
}

Describe 'Warning window helpers (uniwake-aviso.ps1)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
  }

  It 'shows nothing at logon when no warning is in progress, and cleans up its own answers' {
    Mock Show-UwAvisoWindow { throw 'não deveria abrir' }
    Invoke-UwAviso | Should -Be 0
    Save-UwJson (Get-UwUiPathSet).Request ([ordered]@{ requestId = 'r-1'; at = 1; postponesLeft = 0; postponeMinutes = 15; message = 'm' })
    Mock Show-UwAvisoWindow { [void](Write-UwAvisoResponse -RequestId $Request.requestId -Kind 'alive') }
    Invoke-UwAviso | Should -Be 0
    @(Get-ChildItem (Get-UwUiPathSet).Response).Count | Should -Be 0
  }

  It 'formats the countdown and the button' {
    Format-UwCountdown -AtMs 300000 -NowMs 1000 | Should -Be 'Desliga em 4:59'
    Format-UwCountdown -AtMs 1000 -NowMs 5000 | Should -Be 'Desliga em 0:00'
    Get-UwPostponeLabel -Request ([pscustomobject]@{ postponeMinutes = 15 }) | Should -Be 'Adiar 15 min'
  }
}
