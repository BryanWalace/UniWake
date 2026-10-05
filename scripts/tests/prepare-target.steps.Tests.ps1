#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# FR-007.1 steps 2-5. A fake computer: every getter reads $pc and every setter changes it, so the
# tests check end states (idempotence, -WhatIf) without touching the real adapters, registry or
# firewall.

BeforeAll {
  . (Join-Path $PSScriptRoot '..\prepare-target.ps1')
  . (Join-Path $PSScriptRoot 'FakeSystem.ps1')

  $script:Ethernet = [pscustomobject]@{
    Name = 'Ethernet'; ifIndex = 7; NdisPhysicalMedium = 14; Status = 'Up'; Virtual = $false
    InterfaceDescription = 'Intel(R) Ethernet Connection I219-LM'; MacAddress = '00-1A-2B-3C-4D-5E'
  }

  function New-TestProperty {
    param(
      [string]$Keyword, [string]$Display, [string]$Value,
      [string[]]$Displays = @('Desativado', 'Ativado'), [string[]]$Values = @('0', '1')
    )
    [pscustomobject]@{
      RegistryKeyword = $Keyword; DisplayName = $Display; RegistryValue = @($Value)
      ValidDisplayValues = $Displays; ValidRegistryValues = $Values
    }
  }

  function Get-Step([string]$Like) {
    @($script:UwSteps | Where-Object { $_.Etapa -like $Like })
  }
}

Describe 'Preparation steps (FR-007.1 steps 2-5)' {
  BeforeEach {
    $script:pc = @{
      Pm        = [pscustomobject]@{ WakeOnMagicPacket = 'Disabled'; WakeOnPattern = 'Enabled' }
      Armed     = @('HID Keyboard Device')
      Hiberboot = 1
      Advanced  = @(
        (New-TestProperty '*WakeOnMagicPacket' 'Wake on Magic Packet' '0'),
        (New-TestProperty 'S5WakeOnLan' 'Shutdown Wake-On-Lan' '0'),
        (New-TestProperty '*EEE' 'Energy Efficient Ethernet' '1' -Displays @('Disabled', 'Enabled'))
      )
      Rule      = $null
    }
    Register-UwFakeSystem
    Mock Get-UwNetAdapter { @($Ethernet) }
    Mock Get-UwDefaultRouteIndex { @(7) }
    Mock Get-UwPowerManagement { $pc.Pm }
    Mock Set-UwPowerManagement {
      $pc.Pm = [pscustomobject]@{ WakeOnMagicPacket = 'Enabled'; WakeOnPattern = 'Disabled' }
    }
    Mock Get-UwWakeArmedDevice { $pc.Armed }
    Mock Enable-UwDeviceWake { $pc.Armed += $Description }
    Mock Get-UwHiberboot { $pc.Hiberboot }
    Mock Set-UwHiberboot { $pc.Hiberboot = 0 }
    Mock Get-UwAdvancedProperty { $pc.Advanced }
    Mock Set-UwAdvancedProperty {
      foreach ($p in $pc.Advanced) { if ($p.RegistryKeyword -eq $Keyword) { $p.RegistryValue = @($Value) } }
    }
    Mock Get-UwIcmpRule { $pc.Rule }
    Mock Set-UwIcmpRule {
      $pc.Rule = [pscustomobject]@{ Enabled = 'True'; Action = 'Allow'; Profile = 'Domain, Private' }
    }
  }

  It 'applies every step on a fresh computer' {
    Invoke-UwPrepare -SkipEnrollment | Should -Be 0
    $pc.Pm.WakeOnMagicPacket | Should -Be 'Enabled'
    $pc.Pm.WakeOnPattern | Should -Be 'Disabled'
    $pc.Armed | Should -Contain 'Intel(R) Ethernet Connection I219-LM'
    $pc.Hiberboot | Should -Be 0
    ($pc.Advanced | ForEach-Object { '{0}={1}' -f $_.RegistryKeyword, $_.RegistryValue[0] }) |
      Should -Be @('*WakeOnMagicPacket=1', 'S5WakeOnLan=1', '*EEE=0')
    $pc.Rule.Profile | Should -Be 'Domain, Private'
    @($script:UwSteps | Where-Object { $_.Resultado -ne 'OK' }).Count | Should -Be 0
  }

  It 'AC-007-02: with -WhatIf no setter is called and the summary lists the planned changes' {
    Invoke-UwPrepare -SkipEnrollment -WhatIf | Should -Be 0
    foreach ($setter in 'Set-UwPowerManagement', 'Enable-UwDeviceWake', 'Set-UwHiberboot', 'Set-UwAdvancedProperty', 'Set-UwIcmpRule') {
      Should -Invoke $setter -Times 0 -Exactly -Because "$setter must not run under -WhatIf"
    }
    @($script:UwSteps | Where-Object { $_.Resultado -eq 'PLANEJADO' }).Count | Should -Be 6
    Should -Invoke Write-Host -ParameterFilter { "$Object" -like '`[PLANEJADO`] Inicialização Rápida*' }
    Should -Invoke Write-Host -ParameterFilter { "$Object" -like 'Modo simulação (-WhatIf)*' }
  }

  It 'AC-007-03: a property the adapter does not have is reported as NÃO SE APLICA' {
    $pc.Advanced = @($pc.Advanced | Where-Object { $_.RegistryKeyword -ne 'S5WakeOnLan' })
    Invoke-UwPrepare -SkipEnrollment | Should -Be 0
    (Get-Step 'Ligar a partir do desligamento*').Resultado | Should -Be 'NÃO SE APLICA'
  }

  It 'AC-007-04: a second run ends in the same state, changes nothing and reports no errors' {
    Invoke-UwPrepare -SkipEnrollment | Should -Be 0
    $after = ($pc.Advanced | ForEach-Object { $_.RegistryValue[0] }) -join ','
    Invoke-UwPrepare -SkipEnrollment | Should -Be 0
    ($pc.Advanced | ForEach-Object { $_.RegistryValue[0] }) -join ',' | Should -Be $after
    foreach ($setter in 'Set-UwPowerManagement', 'Enable-UwDeviceWake', 'Set-UwHiberboot', 'Set-UwIcmpRule') {
      Should -Invoke $setter -Times 1 -Exactly
    }
    Should -Invoke Set-UwAdvancedProperty -Times 3 -Exactly
    @($script:UwSteps | Where-Object { $_.Resultado -ne 'OK' }).Count | Should -Be 0
    @($script:UwSteps | Where-Object { $_.Detalhe -like 'já estava*' }).Count | Should -Be 6
  }

  It 'uses the display values of drivers in Portuguese and odd value codes' {
    $pc.Advanced = @(
      (New-TestProperty 'EEELinkAdvertisement' 'Ethernet com eficiência de energia' '2' -Displays @('Ligado', 'Desligado') -Values @('2', '5'))
    )
    Invoke-UwPrepare -SkipEnrollment | Should -Be 0
    $pc.Advanced[0].RegistryValue[0] | Should -Be '5'
  }

  It 'asks for a manual change when the on/off value cannot be told' {
    $pc.Advanced = @(
      (New-TestProperty 'EnableGreenEthernet' 'Green Ethernet' '3' -Displays @('Modo A', 'Modo B') -Values @('3', '4'))
    )
    Invoke-UwPrepare -SkipEnrollment | Should -Be 0
    (Get-Step 'Ethernet com eficiência*').Resultado | Should -Be 'MANUAL'
    Should -Invoke Set-UwAdvancedProperty -Times 0 -Exactly
  }

  It '-NoFirewallChange leaves the firewall alone' {
    Invoke-UwPrepare -SkipEnrollment -NoFirewallChange | Should -Be 0
    Should -Invoke Set-UwIcmpRule -Times 0 -Exactly
    (Get-Step 'Ping*').Detalhe | Should -Be 'ignorado (-NoFirewallChange)'
  }

  It 'repairs an existing rule that answers on public networks too' {
    $pc.Rule = [pscustomobject]@{ Enabled = 'True'; Action = 'Allow'; Profile = 'Any' }
    Invoke-UwPrepare -SkipEnrollment | Should -Be 0
    Should -Invoke Set-UwIcmpRule -Times 1 -Exactly -ParameterFilter { $Exists -eq $true }
    $pc.Rule.Profile | Should -Be 'Domain, Private'
  }

  It 'a failing step is FALHOU, the others still run, and the exit code is 1' {
    Mock Set-UwHiberboot { throw 'Acesso negado ao registro.' }
    Invoke-UwPrepare -SkipEnrollment | Should -Be 1
    $step = Get-Step 'Inicialização Rápida*'
    $step.Resultado | Should -Be 'FALHOU'
    $step.Detalhe | Should -Be 'Acesso negado ao registro.'
    Should -Invoke Set-UwIcmpRule -Times 1 -Exactly
  }

  It 'reports a NIC without Magic Packet support as NÃO SE APLICA' {
    $pc.Pm = [pscustomobject]@{ WakeOnMagicPacket = 'Unsupported'; WakeOnPattern = 'Unsupported' }
    Invoke-UwPrepare -SkipEnrollment | Should -Be 0
    (Get-Step 'Placa pode ligar*').Resultado | Should -Be 'NÃO SE APLICA'
    Should -Invoke Enable-UwDeviceWake -Times 0 -Exactly
  }
}
