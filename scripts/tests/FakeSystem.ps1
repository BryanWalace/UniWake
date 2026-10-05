# Safety net for the prepare-target.ps1 tests: call Register-UwFakeSystem in every BeforeEach.
# Every function of the script that reads or changes the computer is mocked; setters throw unless
# a test overrides them, so a forgotten mock can never change the machine running the tests (even
# from an elevated session). The "every system function is faked" test keeps this list complete.

$script:UwSystemFunctions = @(
  'Test-UwElevated', 'Open-UwTranscript', 'Close-UwTranscript',
  'Get-UwNetAdapter', 'Get-UwDefaultRouteIndex',
  'Get-UwPowerManagement', 'Set-UwPowerManagement',
  'Get-UwWakeArmedDevice', 'Enable-UwDeviceWake',
  'Get-UwHiberboot', 'Set-UwHiberboot',
  'Get-UwAdvancedProperty', 'Set-UwAdvancedProperty',
  'Get-UwIcmpRule', 'Set-UwIcmpRule'
)

function Register-UwFakeSystem {
  $refuse = { throw "Teste chamou uma função real que altera o computador: $($MyInvocation.MyCommand.Name)" }
  Mock Write-Host {}
  Mock Test-UwElevated { $true }
  Mock Open-UwTranscript { 'C:\ProgramData\UniWake-Prepare\prepare-test.log' }
  Mock Close-UwTranscript {}
  Mock Get-UwNetAdapter { @() }
  Mock Get-UwDefaultRouteIndex { @() }
  Mock Get-UwPowerManagement { [pscustomobject]@{ WakeOnMagicPacket = 'Enabled'; WakeOnPattern = 'Disabled' } }
  # An already prepared computer whose adapter is the tests' Intel I219-LM.
  Mock Get-UwWakeArmedDevice { @('Intel(R) Ethernet Connection I219-LM') }
  Mock Get-UwHiberboot { 0 }
  Mock Get-UwAdvancedProperty { @() }
  Mock Get-UwIcmpRule { [pscustomobject]@{ Enabled = 'True'; Action = 'Allow'; Profile = 'Domain, Private' } }
  foreach ($setter in 'Set-UwPowerManagement', 'Enable-UwDeviceWake', 'Set-UwHiberboot', 'Set-UwAdvancedProperty', 'Set-UwIcmpRule') {
    Mock $setter $refuse
  }
}
