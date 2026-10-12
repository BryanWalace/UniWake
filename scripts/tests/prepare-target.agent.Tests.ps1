#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# FR-301 (M18-T05): the "Desligamento remoto" step of prepare-target.ps1 — signed enrollment answer
# checked against -HubKeyId, agent scripts checked against its hashes, folder, files, tasks, wake
# timers; -WhatIf, -RemoveAgent and older commands/hubs. Every system call is mocked.

BeforeAll {
  . (Join-Path $PSScriptRoot '..\prepare-target.ps1')
  . (Join-Path $PSScriptRoot 'FakeSystem.ps1')
  . (Join-Path $PSScriptRoot 'FakeAgent.ps1')

  $script:Ethernet = [pscustomobject]@{
    Name = 'Ethernet'; ifIndex = 7; NdisPhysicalMedium = 14; Status = 'Up'; Virtual = $false
    InterfaceDescription = 'Intel(R) Ethernet Connection I219-LM'; MacAddress = '00-1A-2B-3C-4D-5E'
  }
  $script:Scripts = @{
    'uniwake-agent.ps1' = [Text.Encoding]::UTF8.GetBytes('# agente')
    'uniwake-aviso.ps1' = [Text.Encoding]::UTF8.GetBytes('# aviso')
  }
  $script:Hub = New-UwTestHub -Url 'http://10.0.3.5:47101'
  $script:PrepArgs = @{ HubUrl = 'http://10.0.3.5:47101/'; RoomCode = 'LAB3'; Token = 'TOKEN_de-teste_1234567890'; HubKeyId = $script:Hub.KeyId }

  # The hub's answer to a v1.3 enrollment, signed over the nonce the script sent.
  function New-EnrollAnswer {
    param([string]$Nonce, $Signer = $script:Hub, [switch]$NoAgent)
    $answer = [ordered]@{ result = 'updated'; deviceId = 12; room = 'Lab 3'; message = 'Cadastro atualizado na sala Lab 3.' }
    if (-not $NoAgent) {
      $answer.agent = [ordered]@{
        token = 'tok-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; keyId = $script:Hub.KeyId; hubKey = $script:Hub.Entry.publicKey
        scripts = [ordered]@{
          'uniwake-agent.ps1' = [ordered]@{ version = '1.3.0'; sha256 = (Get-UwSha256Hex $script:Scripts['uniwake-agent.ps1']) }
          'uniwake-aviso.ps1' = [ordered]@{ version = '1.3.0'; sha256 = (Get-UwSha256Hex $script:Scripts['uniwake-aviso.ps1']) }
        }
      }
    }
    $r = New-UwSignedResponse -Hub $Signer -Nonce $Nonce -Answer $answer
    $r.Headers['x-uniwake-key'] = $script:Hub.KeyId
    $r
  }
  function Get-Step([string]$Like) { @($script:UwSteps | Where-Object { $_.Etapa -like $Like }) }
}

Describe 'Remote shutdown step (FR-301)' {
  BeforeEach {
    Register-UwFakeSystem
    Mock Get-UwNetAdapter { @($Ethernet) }
    Mock Get-UwDefaultRouteIndex { @(7) }
    $script:Sent = $null
    Mock Send-UwAgentEnrollment {
      $script:Sent = $Json | ConvertFrom-Json
      New-EnrollAnswer -Nonce $script:Sent.agent.nonce
    }
    Mock Get-UwAgentScriptContent { , $script:Scripts[($Uri -split '/')[-1]] }
    $script:Written = @{}
    Mock Initialize-UwAgentFolder {}
    Mock Write-UwAgentFile { $script:Written[(Split-Path -Leaf $Path)] = @{ Bytes = $Bytes; UsersRead = [bool]$UsersRead } }
    Mock Register-UwAgentTask {}
    Mock Start-UwAgentTask {}
    Mock Set-UwWakeTimer {}
  }

  It 'AC-301-01: on a v1.2-prepared PC the new command installs the agent and tasks; a second run ends the same' {
    Mock Get-UwPowercfg { if ($Setting -eq 'RTCWAKE') { @{ Ac = 2; Dc = 0 } } else { @{ Ac = 1800; Dc = 900 } } }
    Invoke-UwPrepare @PrepArgs | Should -Be 0
    $script:Sent.agent.protocol | Should -Be 1
    Should -Invoke Initialize-UwAgentFolder -Times 1 -Exactly -ParameterFilter { $Root -like '*\UniWake' }
    Should -Invoke Register-UwAgentTask -Times 1 -Exactly
    Should -Invoke Start-UwAgentTask -Times 1 -Exactly
    Should -Invoke Set-UwWakeTimer -Times 1 -Exactly
    $script:Written['uniwake-aviso.ps1'].UsersRead | Should -BeTrue
    $script:Written['uniwake-agent.ps1'].UsersRead | Should -BeFalse
    [Text.Encoding]::ASCII.GetString($script:Written['token.txt'].Bytes) | Should -Be 'tok-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    $config = [Text.Encoding]::UTF8.GetString($script:Written['config.json'].Bytes) | ConvertFrom-Json
    $config.hubs[0].keyId | Should -Be $script:Hub.KeyId
    $config.hubs[0].urls | Should -Be @('http://10.0.3.5:47101')
    (Get-Step 'Desligamento remoto')[0].Resultado | Should -Be 'OK'
    (Get-Step 'Temporizadores*')[0].Detalhe | Should -Be 'ativados (na tomada)'
    (Get-Step 'Suspensão*')[0].Detalhe | Should -Be 'após 30 min'

    # Second run: the same files and tasks; wake timers already on.
    Mock Get-UwPowercfg { if ($Setting -eq 'RTCWAKE') { @{ Ac = 1; Dc = 0 } } else { @{ Ac = 0; Dc = 0 } } }
    $first = $script:Written['config.json'].Bytes
    Invoke-UwPrepare @PrepArgs | Should -Be 0
    $script:Written['config.json'].Bytes | Should -Be $first
    (Get-Step 'Temporizadores*')[0].Detalhe | Should -Be 'já estavam ativados'
    (Get-Step 'Suspensão*')[0].Detalhe | Should -Be 'nunca'
    Should -Invoke Set-UwWakeTimer -Times 1 -Exactly # only the first run
  }

  It 'AC-301-02: an older hub (no agent in the answer) → NÃO SE APLICA, every other step still runs' {
    Mock Send-UwAgentEnrollment {
      $sent = $Json | ConvertFrom-Json
      New-EnrollAnswer -Nonce $sent.agent.nonce -NoAgent
    }
    Invoke-UwPrepare @PrepArgs | Should -Be 0
    (Get-Step 'Desligamento remoto')[0].Resultado | Should -Be 'NÃO SE APLICA'
    (Get-Step 'Desligamento remoto')[0].Detalhe | Should -BeLike '*atualize o UniWake*'
    (Get-Step 'Cadastro no UniWake')[0].Resultado | Should -Be 'OK'
    Should -Invoke Register-UwAgentTask -Times 0
  }

  It 'AC-301-03: with -WhatIf nothing is written and the summary lists what would be done' {
    Invoke-UwPrepare @PrepArgs -WhatIf | Should -Be 0
    Should -Invoke Send-UwAgentEnrollment -Times 0
    Should -Invoke Initialize-UwAgentFolder -Times 0
    Should -Invoke Write-UwAgentFile -Times 0
    Should -Invoke Register-UwAgentTask -Times 0
    (Get-Step 'Desligamento remoto')[0].Resultado | Should -Be 'PLANEJADO'
  }

  It 'AC-301-04: -RemoveAgent removes the tasks and the agent files, nothing else' {
    Mock Unregister-UwAgentTask {}
    Mock Remove-UwAgentFolder {}
    Invoke-UwPrepare -RemoveAgent | Should -Be 0
    Should -Invoke Unregister-UwAgentTask -Times 1 -Exactly
    Should -Invoke Remove-UwAgentFolder -Times 1 -Exactly -ParameterFilter { $Root -like '*\UniWake' }
    Should -Invoke Get-UwNetAdapter -Times 0
    (Get-Step 'Remover desligamento remoto')[0].Detalhe | Should -BeLike '*Revogar desligamento remoto*'
  }

  It 'an answer that does not verify with the pinned key installs nothing (spoofed hub)' {
    $script:Intruder = New-UwTestHub
    Mock Send-UwAgentEnrollment {
      $sent = $Json | ConvertFrom-Json
      New-EnrollAnswer -Nonce $sent.agent.nonce -Signer $script:Intruder
    }
    Invoke-UwPrepare @PrepArgs | Should -Be 1
    (Get-Step 'Desligamento remoto')[0].Resultado | Should -Be 'FALHOU'
    Should -Invoke Initialize-UwAgentFolder -Times 0
    Should -Invoke Write-UwAgentFile -Times 0
  }

  It 'a script that arrives changed installs nothing' {
    Mock Get-UwAgentScriptContent { , [Text.Encoding]::UTF8.GetBytes('# alterado') }
    Invoke-UwPrepare @PrepArgs | Should -Be 1
    (Get-Step 'Desligamento remoto')[0].Detalhe | Should -BeLike '*chegou alterado*'
    Should -Invoke Write-UwAgentFile -Times 0
  }

  It 'an older command (without -HubKeyId) enrolls as before and points to the updated command' {
    $old = @{ HubUrl = $PrepArgs.HubUrl; RoomCode = 'LAB3'; Token = $PrepArgs.Token }
    Mock Send-UwEnrollment { [pscustomobject]@{ message = 'Cadastro atualizado na sala Lab 3.' } }
    Invoke-UwPrepare @old | Should -Be 0
    Should -Invoke Send-UwAgentEnrollment -Times 0
    (Get-Step 'Desligamento remoto')[0].Detalhe | Should -BeLike '*comando atualizado*'
  }

  It 'AC-308-02: on a frozen machine the step ends ATENÇÃO with the instruction; enrollment still succeeds' {
    Mock Get-UwFreezeState { @{ product = 'deep_freeze'; state = 'frozen' } }
    Invoke-UwPrepare @PrepArgs | Should -Be 0
    $step = (Get-Step 'Desligamento remoto')[0]
    $step.Resultado | Should -Be 'ATENÇÃO'
    $step.Detalhe | Should -BeLike '*descongele (Thawed / modo manutenção), execute o comando de novo e congele outra vez*'
    (Get-Step 'Congelamento')[0].Detalhe | Should -Be 'detectado (congelada): Deep Freeze'
    (Get-Step 'Cadastro no UniWake')[0].Resultado | Should -Be 'OK'
    Should -Invoke Start-UwAgentTask -Times 0
  }

  It 'AC-308-04: -PersistentPath is kept for the agent and checked; -UwfExclude excludes the data folder on UWF' {
    Mock Get-UwFreezeState { @{ product = 'uwf'; state = 'thawed' } }
    Mock Add-UwUwfExclusion { 0 }
    Mock Protect-UwFolder {}
    Invoke-UwPrepare @PrepArgs -PersistentPath 'T:\UniWake' -UwfExclude | Should -Be 0
    Should -Invoke Protect-UwFolder -Times 1 -Exactly -ParameterFilter { $Path -eq 'T:\UniWake' }
    ([Text.Encoding]::UTF8.GetString($script:Written['config.json'].Bytes) | ConvertFrom-Json).persistentPath | Should -Be 'T:\UniWake'
    (Get-Step 'Pasta persistente')[0].Resultado | Should -Be 'OK'
    (Get-Step 'Exclusão do UWF')[0].Detalhe | Should -BeLike '*\agent\data (vale depois de reiniciar)'
    Should -Invoke Add-UwUwfExclusion -Times 1 -Exactly
    Mock Test-UwPersistentPath { $false }
    Invoke-UwPrepare @PrepArgs -PersistentPath 'T:\UniWake' | Should -Be 0
    (Get-Step 'Pasta persistente')[0].Resultado | Should -Be 'ATENÇÃO'
  }

  It 'reads powercfg values by position, whatever the Windows language' {
    $ptBR = @(
      'GUID do Esquema de Energia: 381b4222-f694-41f0-9685-ff5bb260df2e  (Equilibrado)',
      '  GUID do Subgrupo: 238c9fa8-0aad-41ed-83f4-97be242c8f20  (Suspender)',
      '    GUID da Configuração de Energia: 29f6c1db-86da-48c5-9fdb-f2b67b1f44da  (Suspender após)',
      '      Configuração Mínima Possível: 0x00000000',
      '      Configuração Máxima Possível: 0xffffffff',
      '      Incremento de Configurações Possíveis: 0x00000001',
      '      Unidades de Configurações Possíveis: Segundos',
      '    Índice de Configuração de Energia CA Atual: 0x00000708',
      '    Índice de Configuração de Energia CC Atual: 0x00000384'
    )
    $v = ConvertFrom-UwPowercfgOutput -Lines $ptBR
    $v.Ac | Should -Be 1800
    $v.Dc | Should -Be 900
    ConvertFrom-UwPowercfgOutput -Lines @('erro') | Should -BeNullOrEmpty
  }
}
