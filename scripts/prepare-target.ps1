<#
.SYNOPSIS
  Prepara este computador para ser ligado pelo UniWake (Wake-on-LAN) e o cadastra no painel.
.DESCRIPTION
  Gerado pelo painel do UniWake em "Preparar máquinas". Execute em um PowerShell aberto como
  Administrador.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$HubUrl,
  [string]$RoomCode,
  [string]$Token,
  [switch]$SkipEnrollment,
  [switch]$NoFirewallChange
)

Write-Host 'UniWake: preparação ainda não implementada nesta versão.'
exit 1
