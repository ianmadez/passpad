<#
  PassPad friend side (Windows). Run it through JOIN-PassPad.cmd.
  Installs Tailscale if needed, shows your Tailscale address (send it to the host once),
  checks the link to the host and opens the PassPad page in Firefox.
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Saved = Join-Path $Root 'join.txt'

function Say([string]$Text, [string]$Color = 'Gray') { Write-Host $Text -ForegroundColor $Color }
function Fail([string]$Text) { Say "  XX  $Text" Red; Read-Host '  Press Enter to close'; exit 1 }

Clear-Host
Write-Host ''
Write-Host '   PASS' -NoNewline; Write-Host 'PAD' -ForegroundColor Red -NoNewline; Write-Host '   join a friend' -ForegroundColor DarkGray
Write-Host ''

$ts = (Get-Command tailscale.exe -ErrorAction SilentlyContinue).Source
if (-not $ts) { $ts = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe' }
if (-not (Test-Path $ts)) {
  if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
    Say '  Installing Tailscale. Windows may ask for permission: click Yes.' Yellow
    winget install --id Tailscale.Tailscale -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
  }
  if (-not (Test-Path $ts)) { Start-Process 'https://tailscale.com/download/windows'; Fail 'Install Tailscale from the page that opened, then run this again.' }
}
$me = (& $ts ip -4 2>$null | Select-Object -First 1)
if (-not $me) {
  Say '  Sign in to Tailscale in the browser window that opens.' Yellow
  Start-Process $ts -ArgumentList 'up' -WindowStyle Hidden
  for ($i = 0; $i -lt 120 -and -not $me; $i++) { Start-Sleep 2; $me = (& $ts ip -4 2>$null | Select-Object -First 1) }
  if (-not $me) { Fail 'Tailscale is not signed in yet.' }
}
Say "  Your Tailscale address: $me   (the host types this in once)" Green

$hostIp = if (Test-Path $Saved) { (Get-Content $Saved -Raw).Trim() } else { '' }
if (-not $hostIp) {
  do { $hostIp = (Read-Host "  Host's Tailscale address (starts with 100.)").Trim() } until ($hostIp -match '^\d{1,3}(\.\d{1,3}){3}$')
  Set-Content $Saved $hostIp -Encoding ASCII
}

$ping = (& $ts ping --c 3 $hostIp 2>&1) -join ' '
if ($ping -match 'via DERP') { Say '  Connected, but through a relay: expect extra delay. Restarting Tailscale on both sides often fixes it.' Yellow }
elseif ($ping -match 'pong') { Say '  Direct connection to the host. Nice.' Green }
else { Say '  The host is not reachable yet. Is PassPad running on their side?' Yellow }

$url = "http://$($hostIp):3000"
$firefox = @("$env:ProgramFiles\Mozilla Firefox\firefox.exe", "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($firefox) { Start-Process $firefox $url } else { Start-Process $url }
Say "  Opened $url. Plug in your controller and press a button on it." Green
Start-Sleep 4
