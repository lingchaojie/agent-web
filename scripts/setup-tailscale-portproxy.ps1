# Run from an elevated PowerShell prompt.
$ErrorActionPreference = 'Stop'

$ports = @(8787, 8877)
$connectAddress = '127.0.0.1'
$tailscaleAddress = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.InterfaceAlias -like '*Tailscale*' -and $_.IPAddress -like '100.*' } |
  Select-Object -First 1 -ExpandProperty IPAddress

if (-not $tailscaleAddress) {
  throw 'Could not find a Tailscale IPv4 address on this Windows machine.'
}

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
  throw 'Please run this script from an elevated PowerShell prompt.'
}

foreach ($port in $ports) {
  netsh interface portproxy delete v4tov4 listenaddress=$tailscaleAddress listenport=$port | Out-Null
  netsh interface portproxy add v4tov4 listenaddress=$tailscaleAddress listenport=$port connectaddress=$connectAddress connectport=$port | Out-Null

  $ruleName = "WebAgent $port Tailscale"
  Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalAddress $tailscaleAddress `
    -LocalPort $port |
    Out-Null
}

Write-Host "Configured WebAgent Tailscale access:"
foreach ($port in $ports) {
  Write-Host "  http://$tailscaleAddress`:$port -> http://$connectAddress`:$port"
}
Write-Host ''
netsh interface portproxy show v4tov4
