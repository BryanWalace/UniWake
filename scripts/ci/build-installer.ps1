<#
.SYNOPSIS
  Builds UniWake-Setup for one version (FR-001.4, ADR-022): bundle + web, verified Node runtime,
  verified WinSW, Inno Setup. Used by the CI installer smoke and by the release workflow.
.PARAMETER Version
  SemVer version embedded in the build and the installer.
.PARAMETER OutDir
  Where the installer is written.
.PARAMETER OutName
  Installer file name without .exe (default UniWake-Setup).
.PARAMETER Break
  CI only (M8-T12): the installed hub exits at once, so an update to it must roll back.
.PARAMETER TestUpdateApi
  CI only: loopback fake release server instead of GitHub (ADR-025). Never for releases.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$OutName = 'UniWake-Setup',
  [string]$TestUpdateApi = '',
  [switch]$Break
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$stage = Join-Path $root "build\stage-$Version"

function Invoke-Checked([string]$Exe, [string[]]$Arguments) {
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Exe $($Arguments -join ' ') terminou com $LASTEXITCODE" }
}

$buildArgs = @('scripts/build.ts', '--version', $Version, '--out', (Join-Path $stage 'app'))
if ($TestUpdateApi -ne '') { $buildArgs += @('--test-update-api', $TestUpdateApi) }
Push-Location $root
try {
  Invoke-Checked 'node' $buildArgs
  Invoke-Checked 'node' @('scripts/fetch-node.ts', '--out', (Join-Path $stage 'app'))
  Invoke-Checked 'node' @('scripts/fetch-winsw.ts', '--out', (Join-Path $stage 'WinSW-x64.exe'))
} finally {
  Pop-Location
}
if ($Break) {
  Set-Content -Path (Join-Path $stage 'app\server.mjs') -Value 'process.exit(3);' -Encoding ascii
}

$iscc = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'
if (-not (Test-Path $iscc)) {
  Write-Host 'Instalando o Inno Setup...'
  Invoke-Checked 'choco' @('install', 'innosetup', '-y', '--no-progress')
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Invoke-Checked $iscc @(
  "/DAppVersion=$Version",
  "/DStageDir=$stage",
  "/O$OutDir",
  "/F$OutName",
  (Join-Path $root 'installer\UniWake.iss')
)
$exe = Join-Path $OutDir "$OutName.exe"
if (-not (Test-Path $exe)) { throw "instalador não gerado: $exe" }
Write-Host "Instalador: $exe"
