#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# FR-007.1 prepare-target.ps1. Every call that reads or changes the computer is mocked: these tests
# never touch the real network adapters, registry or firewall.

BeforeAll {
  . (Join-Path $PSScriptRoot '..\prepare-target.ps1')
  . (Join-Path $PSScriptRoot 'FakeSystem.ps1')

  function New-TestAdapter {
    param(
      [string]$Name, [int]$Index, [int]$Medium = 14, [string]$Status = 'Up',
      [string]$Description = 'Intel(R) Ethernet Connection I219-LM', [bool]$Virtual = $false,
      [string]$Mac = '00-1A-2B-3C-4D-5E'
    )
    [pscustomobject]@{
      Name = $Name; ifIndex = $Index; NdisPhysicalMedium = $Medium; Status = $Status
      InterfaceDescription = $Description; Virtual = $Virtual; MacAddress = $Mac
    }
  }

  $script:Ethernet = New-TestAdapter -Name 'Ethernet' -Index 7
  $script:WiFi = New-TestAdapter -Name 'Wi-Fi' -Index 3 -Medium 9 -Description 'Intel(R) Wi-Fi 6 AX201 160MHz' -Mac '00-1A-2B-3C-4D-60'
}

Describe 'Select-UwWiredAdapter (FR-007.1 step 1)' {
  It 'AC-007-01: given one wired and one Wi-Fi adapter, the wired one is chosen' {
    $r = Select-UwWiredAdapter -Adapters @($WiFi, $Ethernet) -DefaultRouteIndexes @(3)
    $r.Chosen.Name | Should -Be 'Ethernet'
    @($r.Others).Count | Should -Be 0
  }

  It 'prefers the wired adapter holding the default route and reports the others' {
    $dock = New-TestAdapter -Name 'Ethernet 2' -Index 4 -Description 'Realtek USB GbE Family Controller' -Mac '00-1A-2B-3C-4D-61'
    $r = Select-UwWiredAdapter -Adapters @($dock, $Ethernet) -DefaultRouteIndexes @(7)
    $r.Chosen.Name | Should -Be 'Ethernet'
    $r.Others.Name | Should -Be 'Ethernet 2'
  }

  It 'ignores virtual, Bluetooth and disconnected adapters' {
    $hyperV = New-TestAdapter -Name 'vEthernet' -Index 9 -Virtual $true
    $vpn = New-TestAdapter -Name 'VPN' -Index 10 -Description 'TAP-Windows Adapter V9'
    $bt = New-TestAdapter -Name 'Bluetooth' -Index 11 -Medium 10 -Description 'Bluetooth Device (Personal Area Network)'
    $down = New-TestAdapter -Name 'Ethernet 3' -Index 2 -Status 'Disconnected'
    $r = Select-UwWiredAdapter -Adapters @($hyperV, $vpn, $bt, $down) -DefaultRouteIndexes @(9)
    $r.Chosen | Should -BeNullOrEmpty
    $r.Others.Name | Should -Be 'Ethernet 3'
  }
}

Describe 'test safety net' {
  It 'every function that reads or changes the computer is faked by Register-UwFakeSystem' {
    $script = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\prepare-target.ps1')
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput($script, [ref]$tokens, [ref]$errors)
    $pure = @('Add-UwStep', 'Select-UwWiredAdapter', 'Get-UwWantedValue', 'Write-UwSummary')
    $defined = $ast.FindAll({ $args[0] -is [Management.Automation.Language.FunctionDefinitionAst] }, $false) |
      ForEach-Object { $_.Name } |
      Where-Object { $_ -notlike 'Invoke-Uw*' -and $pure -notcontains $_ }
    $defined | Where-Object { $UwSystemFunctions -notcontains $_ } | Should -BeNullOrEmpty
  }
}

Describe 'Invoke-UwPrepare' {
  BeforeEach {
    Register-UwFakeSystem
    Mock Get-UwNetAdapter { @($WiFi, $Ethernet) }
    Mock Get-UwDefaultRouteIndex { @(7) }
  }

  It 'AC-007-11: given a non-elevated session, exits 3 with the pt-BR message and changes nothing' {
    Mock Test-UwElevated { $false }
    Invoke-UwPrepare -SkipEnrollment | Should -Be 3
    Should -Invoke Write-Host -ParameterFilter { $Object -eq 'Abra o PowerShell como Administrador e execute novamente.' }
    Should -Invoke Open-UwTranscript -Times 0
    Should -Invoke Get-UwNetAdapter -Times 0
  }

  It 'asks for the full command when enrollment parameters are missing' {
    Invoke-UwPrepare -HubUrl 'http://10.0.3.5:47101' | Should -Be 2
    Should -Invoke Write-Host -ParameterFilter { "$Object" -like 'Faltam -HubUrl, -RoomCode e -Token*' }
    Should -Invoke Open-UwTranscript -Times 0
  }

  It 'writes a transcript and lists the chosen adapter in the summary' {
    Invoke-UwPrepare -SkipEnrollment | Should -Be 0
    Should -Invoke Open-UwTranscript -Times 1
    Should -Invoke Close-UwTranscript -Times 1
    Should -Invoke Write-Host -ParameterFilter { "$Object" -like '`[OK`] Placa de rede cabeada - Ethernet (*00-1A-2B-3C-4D-5E)' }
    Should -Invoke Write-Host -ParameterFilter { "$Object" -like '*Wake on LAN*' }
  }

  It 'fails the step (exit 1) when no wired adapter is connected' {
    Mock Get-UwNetAdapter { @($WiFi) }
    Invoke-UwPrepare -SkipEnrollment | Should -Be 1
    Should -Invoke Write-Host -ParameterFilter { "$Object" -like '`[FALHOU`] Placa de rede cabeada*cabo de rede*' }
  }
}
