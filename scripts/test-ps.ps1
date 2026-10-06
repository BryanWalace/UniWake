<#
.SYNOPSIS
  Runs PSScriptAnalyzer and the Pester tests for the PowerShell scripts (constitution §4.2).
.DESCRIPTION
  Pester 5 and PSScriptAnalyzer are pinned and fetched once from the PowerShell Gallery into
  .tools\psmodules (git-ignored), checked against the SHA-256 below, so nothing is installed system
  wide and local runs match CI. Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [switch]$SkipAnalyzer
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$modules = Join-Path $root '.tools\psmodules'

$pinned = @(
  @{ Name = 'Pester'; Version = '5.9.1'; Sha256 = '8DD4060FC3BC895F05BD655E4AB82ABE346DE54A4E6415DFB727CC8378672B69' },
  @{ Name = 'PSScriptAnalyzer'; Version = '1.25.0'; Sha256 = '14E634C828EB98EFB9F40B2918BA90F139ED5ECCDF663A2A747736D996995D60' }
)

function Install-PinnedModule([hashtable]$m) {
  $dir = Join-Path $modules "$($m.Name)\$($m.Version)"
  if (Test-Path (Join-Path $dir "$($m.Name).psd1")) { return $dir }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  New-Item -ItemType Directory -Force -Path $modules | Out-Null
  $zip = Join-Path $modules "$($m.Name).$($m.Version).zip"
  $url = "https://www.powershellgallery.com/api/v2/package/$($m.Name)/$($m.Version)"
  Write-Host "Baixando $($m.Name) $($m.Version)..."
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash
  if ($hash -ne $m.Sha256) {
    Remove-Item -LiteralPath $zip
    throw "SHA-256 inesperado para $($m.Name) $($m.Version): $hash"
  }
  Expand-Archive -LiteralPath $zip -DestinationPath $dir -Force
  Remove-Item -LiteralPath $zip
  return $dir
}

foreach ($m in $pinned) { $null = Install-PinnedModule $m }
$env:PSModulePath = "$modules;$env:PSModulePath"
Import-Module (Join-Path $modules 'Pester\5.9.1\Pester.psd1') -Force

$failed = 0
if (-not $SkipAnalyzer) {
  Import-Module (Join-Path $modules 'PSScriptAnalyzer\1.25.0\PSScriptAnalyzer.psd1') -Force
  $settings = Join-Path $PSScriptRoot 'PSScriptAnalyzerSettings.psd1'
  $targets = @(
    (Join-Path $root 'scripts\prepare-target.ps1'),
    (Join-Path $root 'scripts\test-ps.ps1')
  ) + @(Get-ChildItem -Path (Join-Path $root 'apps\server\helper') -Filter '*.ps1' | ForEach-Object FullName)
  $targets += @(Get-ChildItem -Path (Join-Path $root 'scripts\ci') -Filter '*.ps1' | ForEach-Object FullName)
  $issues = @($targets | ForEach-Object { Invoke-ScriptAnalyzer -Path $_ -Settings $settings })
  if ($issues.Count -gt 0) {
    $issues | Format-Table -AutoSize RuleName, Severity, ScriptName, Line, Message | Out-String -Width 220 | Write-Host
    $failed += $issues.Count
  } else {
    Write-Host 'PSScriptAnalyzer: nenhum problema.'
  }
}

$config = New-PesterConfiguration
$config.Run.Path = Join-Path $PSScriptRoot 'tests'
$config.Run.Exit = $false
$config.Run.PassThru = $true
$config.Output.Verbosity = 'Detailed'
$result = Invoke-Pester -Configuration $config
$failed += $result.FailedCount
if ($result.TotalCount -eq 0) { Write-Host 'Nenhum teste Pester encontrado.'; $failed++ }
exit ([int]($failed -gt 0))
