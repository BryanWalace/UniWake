#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# FR-007.3 / ADR-011: the one-line command shown by "Preparar máquinas". fixtures\one-liner.txt is
# the exact text the hub builds (checked by apps/server/test/enrollment-tokens.test.ts). The
# download is mocked into TestDrive and powershell.exe is mocked: nothing reaches the network and
# no script is started.

BeforeAll {
  $script:command = (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'fixtures\one-liner.txt')).Trim()
  # Same text as ONE_LINER_FIXTURE.script in apps/server/test/fixtures/one-liner.ts.
  $script:original = [Text.Encoding]::UTF8.GetBytes("Write-Host `"conteúdo original do script`"`r`n")
}

Describe 'one-line prepare command (FR-007.3, ADR-011)' {
  BeforeEach {
    $script:savedTemp = $env:TEMP
    $env:TEMP = "$TestDrive"
    Mock Write-Host {}
    Mock powershell.exe {}
  }

  AfterEach {
    $env:TEMP = $script:savedTemp
  }

  It 'AC-007-14: a tampered download aborts before executing with "Arquivo alterado — não execute"' {
    Mock Invoke-WebRequest {
      [IO.File]::WriteAllBytes($OutFile, [Text.Encoding]::UTF8.GetBytes('Write-Host "alterado"'))
    }
    Invoke-Expression $command
    Should -Invoke Write-Host -Times 1 -Exactly -ParameterFilter { "$Object" -eq 'Arquivo alterado — não execute' }
    Should -Invoke powershell.exe -Times 0 -Exactly
    Test-Path -LiteralPath (Join-Path $TestDrive 'uniwake-prepare-target.ps1') | Should -BeFalse
  }

  It 'runs the verified script with the hub URL, room code and token' {
    Mock Invoke-WebRequest { [IO.File]::WriteAllBytes($OutFile, $original) }
    Invoke-Expression $command
    Should -Invoke powershell.exe -Times 1 -Exactly -ParameterFilter {
      ($args -join ' ') -like '*-File *uniwake-prepare-target.ps1 -HubUrl http://127.0.0.1:47101 -RoomCode LAB3 -Token TOKEN_de-teste_1234567890'
    }
    Should -Invoke Write-Host -Times 0 -Exactly -ParameterFilter { "$Object" -like 'Arquivo alterado*' }
  }

  It 'stops on a failed download instead of reaching the hash check' {
    Mock Invoke-WebRequest { throw 'Não foi possível conectar ao servidor remoto' }
    { Invoke-Expression $command } | Should -Throw '*conectar*'
    Should -Invoke powershell.exe -Times 0 -Exactly
    Should -Invoke Write-Host -Times 0 -Exactly -ParameterFilter { "$Object" -like 'Arquivo alterado*' }
  }
}
