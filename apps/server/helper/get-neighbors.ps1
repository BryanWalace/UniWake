#Requires -Version 5.1
<#
  UniWake network discovery (FR-101): the IPv4 neighbor (ARP) cache as JSON, read-only.
  States are numbers (MSFT_NetNeighbor), so the output is the same in every Windows language.
#>
$ErrorActionPreference = 'Stop'
Get-NetNeighbor -AddressFamily IPv4 |
  Select-Object IPAddress, LinkLayerAddress, @{ Name = 'State'; Expression = { [int]$_.State } } |
  ConvertTo-Json -Compress
