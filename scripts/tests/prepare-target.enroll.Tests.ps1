#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# FR-007.1 step 7 / FR-007.2: enrollment from prepare-target.ps1 and the exit codes. The HTTP call
# (Send-UwEnrollment) is mocked; nothing reaches the network.

BeforeAll {
  . (Join-Path $PSScriptRoot '..\prepare-target.ps1')
  . (Join-Path $PSScriptRoot 'FakeSystem.ps1')

  $script:Ethernet = [pscustomobject]@{
    Name = 'Ethernet'; ifIndex = 7; NdisPhysicalMedium = 14; Status = 'Up'; Virtual = $false
    InterfaceDescription = 'Intel(R) Ethernet Connection I219-LM'; MacAddress = '00-1A-2B-3C-4D-5E'
  }
  $script:WiFi = [pscustomobject]@{
    Name = 'Wi-Fi'; ifIndex = 3; NdisPhysicalMedium = 9; Status = 'Up'; Virtual = $false
    InterfaceDescription = 'Intel(R) Wi-Fi 6 AX201 160MHz'; MacAddress = '00-1A-2B-3C-4D-60'
  }
  $script:EnrollArgs = @{ HubUrl = 'http://10.0.3.5:47101/'; RoomCode = 'LAB3'; Token = 'TOKEN_de-teste_1234567890' }

  # A failed Invoke-RestMethod as Windows PowerShell 5.1 reports it: the body is in ErrorDetails.
  function New-HttpError([string]$Body) {
    $ex = New-Object System.Net.WebException('O servidor remoto retornou um erro: (401) Não Autorizado.')
    $record = New-Object System.Management.Automation.ErrorRecord($ex, 'WebCmdletWebResponseException', 'InvalidOperation', $null)
    $record.ErrorDetails = New-Object System.Management.Automation.ErrorDetails($Body)
    return $record
  }
}

Describe 'enrollment (FR-007.1 step 7)' {
  BeforeEach {
    Register-UwFakeSystem
    Mock Get-UwNetAdapter { @($WiFi, $Ethernet) }
    Mock Get-UwDefaultRouteIndex { @(7) }
    Mock Send-UwEnrollment {
      [pscustomobject]@{ result = 'created'; deviceId = 12; room = 'Lab 3'; message = 'Computador cadastrado na sala Lab 3.' }
    }
  }

  It 'posts this computer to the hub with the token and prints the hub message (exit 0)' {
    Invoke-UwPrepare @EnrollArgs | Should -Be 0
    Should -Invoke Send-UwEnrollment -Times 1 -Exactly -ParameterFilter {
      $Uri -eq 'http://10.0.3.5:47101/agent/enroll' -and $Token -eq 'TOKEN_de-teste_1234567890'
    }
    Should -Invoke Write-Host -ParameterFilter { "$Object" -eq '[OK] Cadastro no UniWake - Computador cadastrado na sala Lab 3.' }
  }

  It 'sends MAC, other MACs, host, IP, hardware, OS and the step results' {
    $script:sent = $null
    Mock Send-UwEnrollment { $script:sent = $Json | ConvertFrom-Json; [pscustomobject]@{ message = 'ok' } }
    Invoke-UwPrepare @EnrollArgs | Should -Be 0
    $sent.roomCode | Should -Be 'LAB3'
    $sent.mac | Should -Be '00-1A-2B-3C-4D-5E'
    @($sent.otherMacs) | Should -Be @('00-1A-2B-3C-4D-60')
    $sent.hostname | Should -Be 'LAB3-PC01'
    $sent.ip | Should -Be '10.0.3.41'
    $sent.manufacturer | Should -Be 'Dell Inc.'
    $sent.os | Should -Be 'Microsoft Windows 11 Pro 23H2'
    $sent.prepareResults.'Inicialização Rápida (Fast Startup) desativada' | Should -Be 'OK: já estava desativada'
    ($sent.prepareResults.PSObject.Properties | ForEach-Object { $_.Name.Length } | Measure-Object -Maximum).Maximum |
      Should -BeLessOrEqual 128
  }

  It 'a refused enrollment shows the hub message and exits 2' {
    Mock Send-UwEnrollment {
      throw (New-HttpError '{"code":"ENROLL_TOKEN_EXPIRED","message":"Código de cadastro expirado. Gere um novo em \"Preparar máquinas\"."}')
    }
    Invoke-UwPrepare @EnrollArgs | Should -Be 2
    Should -Invoke Write-Host -ParameterFilter { "$Object" -like '`[FALHOU`] Cadastro no UniWake - Código de cadastro expirado.*' }
  }

  It 'an unreachable hub is reported with the network error and exits 2' {
    Mock Send-UwEnrollment { throw 'Não é possível conectar-se ao servidor remoto' }
    Invoke-UwPrepare @EnrollArgs | Should -Be 2
    Should -Invoke Write-Host -ParameterFilter { "$Object" -like '*Cadastro no UniWake - Não é possível conectar-se*' }
  }

  It 'enrollment failure wins over a failed step (exit 2), a failed step alone gives 1' {
    Mock Get-UwHiberboot { 1 }
    Mock Set-UwHiberboot { throw 'Acesso negado.' }
    Mock Send-UwEnrollment { throw 'falhou' }
    Invoke-UwPrepare @EnrollArgs | Should -Be 2
    Mock Send-UwEnrollment { [pscustomobject]@{ message = 'ok' } }
    Invoke-UwPrepare @EnrollArgs | Should -Be 1
  }

  It 'without a wired adapter the computer is not enrolled (exit 2)' {
    Mock Get-UwNetAdapter { @($WiFi) }
    Invoke-UwPrepare @EnrollArgs | Should -Be 2
    Should -Invoke Send-UwEnrollment -Times 0 -Exactly
  }

  It '-SkipEnrollment and -WhatIf never contact the hub' {
    Invoke-UwPrepare -SkipEnrollment | Should -Be 0
    Invoke-UwPrepare @EnrollArgs -WhatIf | Should -Be 0
    Should -Invoke Send-UwEnrollment -Times 0 -Exactly
    ($script:UwSteps | Where-Object { $_.Etapa -eq 'Cadastro no UniWake' }).Resultado | Should -Be 'PLANEJADO'
  }
}
