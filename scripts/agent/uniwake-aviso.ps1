<#
.SYNOPSIS
  UniWake shutdown warning for the logged-on user (v1.3, ADR-046). Run by the task "UniWake Aviso".
.DESCRIPTION
  Placeholder until M18-T04: the warning window with "Adiar" is not built yet. The agent falls back
  to the native shutdown.exe warning (no postpone) when this script shows nothing (ADR-046).
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
