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
  'Get-UwIcmpRule', 'Set-UwIcmpRule',
  'Get-UwSystemInfo', 'Get-UwIPv4Address', 'Send-UwEnrollment',
  # v1.3 remote shutdown step (FR-301)
  'Send-UwAgentEnrollment', 'Get-UwAgentScriptContent', 'Initialize-UwAgentFolder', 'Write-UwAgentFile',
  'Register-UwAgentTask', 'Start-UwAgentTask', 'Unregister-UwAgentTask', 'Remove-UwAgentFolder',
  'Get-UwPowercfg', 'Set-UwWakeTimer', 'Get-UwFreezeState', 'Add-UwUwfExclusion', 'Test-UwPersistentPath', 'Protect-UwFolder',
  'Get-UwFolderState'
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
  Mock Get-UwSystemInfo {
    [pscustomobject]@{ Hostname = 'LAB3-PC01'; Manufacturer = 'Dell Inc.'; Model = 'OptiPlex 7090'; Serial = 'ABC1234'; Os = 'Microsoft Windows 11 Pro 23H2' }
  }
  Mock Get-UwIPv4Address { '10.0.3.41' }
  # Already prepared for remote shutdown: wake timers on, sleep after 30 min, nothing frozen.
  Mock Get-UwPowercfg { if ($Setting -eq 'RTCWAKE') { @{ Ac = 1; Dc = 1 } } else { @{ Ac = 1800; Dc = 900 } } }
  Mock Get-UwFreezeState { @{ product = $null; state = 'none' } }
  Mock Test-UwPersistentPath { $true }
  Mock Get-UwFolderState { 'missing' }
  Mock Get-UwAgentScriptContent { throw 'sem rede no teste' }
  foreach ($setter in 'Set-UwPowerManagement', 'Enable-UwDeviceWake', 'Set-UwHiberboot', 'Set-UwAdvancedProperty', 'Set-UwIcmpRule', 'Send-UwEnrollment',
    'Send-UwAgentEnrollment', 'Initialize-UwAgentFolder', 'Write-UwAgentFile', 'Register-UwAgentTask', 'Start-UwAgentTask',
    'Unregister-UwAgentTask', 'Remove-UwAgentFolder', 'Set-UwWakeTimer', 'Add-UwUwfExclusion', 'Protect-UwFolder') {
    Mock $setter $refuse
  }
}
