#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# M29-T04 (FR-604.1, ADR-060): what the agent tells the hub about the antivirus — installed products
# and the Microsoft Defender detections that touch UniWake — read every 15 minutes, sent on change.

BeforeAll {
  . (Join-Path $PSScriptRoot '..\agent\uniwake-agent.ps1')
  . (Join-Path $PSScriptRoot 'FakeAgent.ps1')
  $script:T0 = [DateTimeOffset]::new(2026, 10, 17, 15, 0, 0, [TimeSpan]::Zero).ToUnixTimeMilliseconds()
  $script:When = [DateTimeOffset]::FromUnixTimeMilliseconds($script:T0 - 3600000).LocalDateTime

  function New-TestRaw {
    @{
      products   = @(
        @{ name = 'Windows Defender'; state = 397568 },   # 0x061100: on, up to date
        @{ name = 'ESET Security'; state = 266256 }       # 0x041010: on, out of date
      )
      detections = @(
        @{ at = $script:When; resources = @('file:_C:\ProgramData\UniWake\agent\uniwake-agent.ps1'); threat = 'Trojan:PowerShell/Teste.A'; status = 3 },
        @{ at = $script:When; resources = @('file:_C:\Users\Public\jogo.exe'); threat = 'PUA:Win32/Jogo'; status = 3 },
        @{ at = [DateTimeOffset]::FromUnixTimeMilliseconds($script:T0 - 20L * 86400000).LocalDateTime; resources = @('file:_C:\ProgramData\UniWake\agent\uniwake-aviso.ps1'); threat = 'Velho'; status = 4 }
      )
    }
  }
}

Describe 'Antivirus facts (FR-604.1)' {
  It 'AC-604-01: keeps only recent detections touching UniWake, file names only, with the action' {
    $av = ConvertTo-UwAntivirusInfo -Raw (New-TestRaw) -Now $script:T0
    @($av.detections).Count | Should -Be 1
    $d = $av.detections[0]
    $d.file | Should -Be 'uniwake-agent.ps1'
    $d.threat | Should -Be 'Trojan:PowerShell/Teste.A'
    $d.action | Should -Be 'quarentena'
    $d.at | Should -Be ($script:T0 - 3600000)
    $av.products[0].name | Should -Be 'Windows Defender'
    $av.products[0].enabled | Should -BeTrue
    $av.products[0].upToDate | Should -BeTrue
    $av.products[1].upToDate | Should -BeFalse
  }

  It 'names a detection by the command line that ran an agent script' {
    $raw = @{ products = @(); detections = @(@{ at = $script:When; resources = @('CmdLine:_C:\Windows\System32\powershell.exe -File C:\ProgramData\UniWake\agent\uniwake-aviso.ps1'); threat = $null; status = 99 }) }
    $d = (ConvertTo-UwAntivirusInfo -Raw $raw -Now $script:T0).detections[0]
    $d.file | Should -Be 'uniwake-aviso.ps1'
    $d.threat | Should -Be 'desconhecida'
    $d.action | Should -BeNullOrEmpty
  }
}

Describe 'Read every 15 minutes, sent when it changes (FR-604.1)' {
  BeforeEach {
    Register-UwFakeAgent -Root (Join-Path $TestDrive ([guid]::NewGuid()))
    $script:UwFake.Now = $script:T0
    Mock Get-UwAntivirusRaw { New-TestRaw }
    $script:Health = Read-UwHealthState (Join-Path $script:UwDataDir 'health.json')
  }

  It 'reads at most every 15 minutes unless forced; unchanged data is not sent again for 6 hours' {
    $first = Get-UwAntivirusReport -Health $script:Health -Now $script:T0
    $first.Report.detections[0].file | Should -Be 'uniwake-agent.ps1'
    # Marked sent (what Invoke-UwPoll does once a hub took it).
    $script:Health.avHash = $first.Hash
    $script:Health.avSentAt = $script:T0
    Get-UwAntivirusReport -Health $script:Health -Now ($script:T0 + 60000) | Should -BeNullOrEmpty
    Should -Invoke Get-UwAntivirusRaw -Times 1 -Exactly
    Get-UwAntivirusReport -Health $script:Health -Now ($script:T0 + 16 * 60000) | Should -BeNullOrEmpty # same data
    Should -Invoke Get-UwAntivirusRaw -Times 2 -Exactly
    (Get-UwAntivirusReport -Health $script:Health -Now ($script:T0 + 7 * 3600000)).Report | Should -Not -BeNullOrEmpty
    Mock Get-UwAntivirusRaw { @{ products = @(); detections = @() } } # changed
    (Get-UwAntivirusReport -Health $script:Health -Now ($script:T0 + 60000) -Force).Report | Should -Not -BeNullOrEmpty
  }

  It 'a blocked update or a repair note newer than the last reading asks for a reading now' {
    $script:Health.avCheckedAt = $script:T0
    Test-UwAntivirusDue -Health $script:Health | Should -BeFalse
    $script:Health.update = [pscustomobject]@{ outcome = 'write_blocked'; at = $script:T0 + 1000 }
    Test-UwAntivirusDue -Health $script:Health | Should -BeTrue
    $script:Health.update = $null
    Test-UwAntivirusDue -Health $script:Health -Repairs @(@{ at = $script:T0 + 5 }) | Should -BeTrue
  }
}
