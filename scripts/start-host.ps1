<#
  PassPad host starter (Windows 10/11, Windows PowerShell 5.1). Run it through START-PassPad.cmd.

    START-PassPad.cmd            first run: guided setup, then start everything
    START-PassPad.cmd doctor     check Tailscale, the PS5, the firewall and the downloads
    START-PassPad.cmd setup      run the setup questions again
    START-PassPad.cmd update     download the newest PassPad release
    START-PassPad.cmd autostart  start PassPad when Windows starts (run again to turn it off)

  Every download is checked against its published SHA-256 before it is used.
#>
param([string]$Command = 'start')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is 10x slower with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
$Vendor = Join-Path $Root 'vendor'
$ConfigDir = Join-Path $Root 'config'
$EnvFile = Join-Path $ConfigDir 'host.env'
$PresetFile = Join-Path $Root 'passpad.env'
$Port = 3000
$Repo = 'ianmadez/passpad'
$BunVersion = '1.4.5'
$MediamtxVersion = 'v1.21.4'
$TailnetRange = '100.64.0.0/10'

# ---------------------------------------------------------------- output helpers

function Say([string]$Text, [string]$Color = 'Gray') { Write-Host $Text -ForegroundColor $Color }
function Step([string]$Text) { Write-Host ''; Write-Host "  >> $Text" -ForegroundColor Cyan }
function Good([string]$Text) { Write-Host "     OK  $Text" -ForegroundColor Green }
function Warn([string]$Text) { Write-Host "     !!  $Text" -ForegroundColor Yellow }
$IssuesUrl = 'https://github.com/ianmadez/passpad/issues/new'
$LogDir = Join-Path $Root 'logs'

function Fail([string]$Text) {
  Write-Host ''
  Write-Host "  XX  $Text" -ForegroundColor Red
  Write-Host ''
  # Everything this window printed is in logs\starter.log; offer to copy it or report it.
  $log = ''
  try { Stop-Transcript | Out-Null } catch { }
  $file = Join-Path $LogDir 'starter.log'
  if (Test-Path $file) { $log = (Get-Content $file -Tail 80) -join "`n" }
  $log = $log -replace '([a-z]+://)[^@\s/]+@', '$1***@' -replace '(PASS[A-Z_]*\s*[=:]\s*)\S+', '$1***'
  $report = "PassPad starter problem: $Text`nWindows: $([Environment]::OSVersion.VersionString)`n`n$log"
  try { Set-Clipboard -Value $report; Write-Host '  The details are copied: paste them to whoever helps you.' -ForegroundColor Yellow } catch { }
  $answer = Read-Host '  Open a bug report on GitHub with these details? (y/N)'
  if ($answer -match '^[yY]') {
    Add-Type -AssemblyName System.Web
    $body = "**What happened?**`n`n`n**Details** (full version is on your clipboard)`n``````n$($report.Substring(0, [Math]::Min(5000, $report.Length)))`n``````"
    $url = "$($IssuesUrl)?title=$([Web.HttpUtility]::UrlEncode('[starter] ' + $Text))&labels=bug&body=$([Web.HttpUtility]::UrlEncode($body))"
    Start-Process $url
  }
  Read-Host '  Press Enter to close'
  exit 1
}

function Banner {
  Clear-Host
  Write-Host ''
  Write-Host '   PASS' -ForegroundColor White -NoNewline
  Write-Host 'PAD' -ForegroundColor Red -NoNewline
  Write-Host '   share your PS5 with friends, from the browser' -ForegroundColor DarkGray
  Write-Host '   ---------------------------------------------------------' -ForegroundColor DarkGray
}

# ---------------------------------------------------------------- settings file

function Read-EnvFile([string]$Path) {
  $values = @{}
  if (Test-Path $Path) {
    foreach ($line in Get-Content $Path) {
      if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') { $values[$Matches[1]] = $Matches[2] }
    }
  }
  return $values
}

function Write-EnvFile([string]$Path, [hashtable]$Values) {
  New-Item -ItemType Directory -Force (Split-Path $Path) | Out-Null
  $lines = @('# PassPad settings, written by START-PassPad.cmd. Keep this file private.')
  foreach ($key in ($Values.Keys | Sort-Object)) { $lines += "$key=$($Values[$key])" }
  Set-Content -Path $Path -Value $lines -Encoding ASCII
  # Only this Windows user may read it (it holds the video publisher password).
  icacls $Path /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
}

function New-Secret {
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([Convert]::ToBase64String($bytes) -replace '[+/=]', 'x')
}

# ---------------------------------------------------------------- downloads

function Get-Verified([string]$Url, [string]$Dest, [string]$ExpectedSha) {
  Say "     downloading $(Split-Path $Url -Leaf) ..." DarkGray
  Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing
  $actual = (Get-FileHash -Algorithm SHA256 $Dest).Hash.ToLower()
  if ($actual -ne $ExpectedSha.ToLower()) {
    Remove-Item $Dest -Force
    Fail "Download check failed for $(Split-Path $Url -Leaf) (the file did not match its published fingerprint). Try again later."
  }
}

function Find-Sha([string]$SumsText, [string]$FileName) {
  foreach ($line in ($SumsText -split "`n")) {
    if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$' -and $Matches[2] -eq $FileName) { return $Matches[1] }
  }
  Fail "No published fingerprint for $FileName."
}

function Install-Bun {
  $exe = Join-Path $Vendor 'bun\bun.exe'
  if (Test-Path $exe) { return $exe }
  Step 'Getting Bun (runs the PassPad server)'
  $base = "https://github.com/oven-sh/bun/releases/download/bun-v$BunVersion"
  $sums = (Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -UseBasicParsing).Content
  $zip = Join-Path $env:TEMP 'passpad-bun.zip'
  Get-Verified "$base/bun-windows-x64.zip" $zip (Find-Sha $sums 'bun-windows-x64.zip')
  $tmp = Join-Path $env:TEMP 'passpad-bun'
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $zip $tmp -Force
  New-Item -ItemType Directory -Force (Split-Path $exe) | Out-Null
  Copy-Item (Get-ChildItem $tmp -Recurse -Filter bun.exe | Select-Object -First 1).FullName $exe
  Remove-Item $zip, $tmp -Recurse -Force
  Good 'Bun ready'
  return $exe
}

function Install-Mediamtx {
  $exe = Join-Path $Vendor 'mediamtx\mediamtx.exe'
  if (Test-Path $exe) { return $exe }
  Step 'Getting MediaMTX (sends the video to your friends)'
  $base = "https://github.com/bluenviron/mediamtx/releases/download/$MediamtxVersion"
  $name = "mediamtx_$($MediamtxVersion)_windows_amd64.zip"
  $sums = (Invoke-WebRequest -Uri "$base/checksums.sha256" -UseBasicParsing).Content
  $zip = Join-Path $env:TEMP $name
  Get-Verified "$base/$name" $zip (Find-Sha $sums $name)
  New-Item -ItemType Directory -Force (Split-Path $exe) | Out-Null
  Expand-Archive $zip (Split-Path $exe) -Force
  Remove-Item $zip -Force
  Good 'MediaMTX ready'
  return $exe
}

function Install-Chiaki {
  $exe = Join-Path $Vendor 'chiaki\chiaki.exe'
  if (Test-Path $exe) { return $exe }
  Step 'Getting chiaki-ng (talks to the PS5; PassPad build)'
  $base = "https://github.com/$Repo/releases/latest/download"
  $name = 'chiaki-ng-passpad-win64.zip'
  try { $sha = ((Invoke-WebRequest -Uri "$base/$name.sha256" -UseBasicParsing).Content -split '\s+')[0] }
  catch { Fail "Could not find the chiaki-ng download on GitHub ($Repo releases). Ask whoever sent you PassPad to publish a release." }
  $zip = Join-Path $env:TEMP $name
  Get-Verified "$base/$name" $zip $sha
  $dir = Split-Path $exe
  New-Item -ItemType Directory -Force $dir | Out-Null
  Expand-Archive $zip $dir -Force
  Remove-Item $zip -Force
  $found = Get-ChildItem $dir -Recurse -Filter chiaki.exe | Select-Object -First 1
  if (-not $found) { Fail 'The chiaki-ng download did not contain chiaki.exe.' }
  if ($found.DirectoryName -ne $dir) {
    Get-ChildItem $found.DirectoryName | Move-Item -Destination $dir -Force
  }
  Good 'chiaki-ng ready'
  return $exe
}

# ---------------------------------------------------------------- Tailscale

function Find-Tailscale {
  $cmd = Get-Command tailscale.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $default = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
  if (Test-Path $default) { return $default }
  return $null
}

function Ensure-Tailscale {
  Step 'Tailscale (the private link between you and your friends)'
  $ts = Find-Tailscale
  if (-not $ts) {
    if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
      Say '     Installing Tailscale. Windows may ask for permission: click Yes.' Yellow
      winget install --id Tailscale.Tailscale -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
      $ts = Find-Tailscale
    }
    if (-not $ts) {
      Start-Process 'https://tailscale.com/download/windows'
      Fail 'Please install Tailscale from the page that just opened, then double-click START-PassPad.cmd again.'
    }
  }
  $ip = (& $ts ip -4 2>$null | Select-Object -First 1)
  if (-not $ip) {
    Say '     Sign in to Tailscale in the browser window that opens (use the account your friends invited you to).' Yellow
    Start-Process $ts -ArgumentList 'up' -WindowStyle Hidden
    for ($i = 0; $i -lt 120 -and -not $ip; $i++) {
      Start-Sleep 2
      $ip = (& $ts ip -4 2>$null | Select-Object -First 1)
    }
    if (-not $ip) { Fail 'Tailscale is not signed in yet. Sign in from the Tailscale icon by the clock, then try again.' }
  }
  Good "This laptop's Tailscale address: $ip"
  return @{ Exe = $ts; Ip = "$ip".Trim() }
}

# ---------------------------------------------------------------- PS5

function Find-PS5 {
  # PlayStation discovery: a broadcast "SRCH" on UDP 9302 makes every PS5 on the network answer.
  $udp = New-Object Net.Sockets.UdpClient
  try {
    $udp.EnableBroadcast = $true
    $udp.Client.ReceiveTimeout = 2500
    $msg = [Text.Encoding]::ASCII.GetBytes("SRCH * HTTP/1.1`ndevice-discovery-protocol-version:00030010`n")
    [void]$udp.Send($msg, $msg.Length, (New-Object Net.IPEndPoint ([Net.IPAddress]::Broadcast), 9302))
    $from = New-Object Net.IPEndPoint ([Net.IPAddress]::Any), 0
    $reply = [Text.Encoding]::ASCII.GetString($udp.Receive([ref]$from))
    $name = if ($reply -match 'host-name:(.+)') { $Matches[1].Trim() } else { 'PS5' }
    return @{ Ip = $from.Address.ToString(); Name = $name; Awake = ($reply -match '200 Ok') }
  } catch {
    return $null
  } finally {
    $udp.Close()
  }
}

function Test-Ipv4([string]$Text) { return $Text -match '^\d{1,3}(\.\d{1,3}){3}$' }

# ---------------------------------------------------------------- setup questions

function Run-Setup([hashtable]$Cfg, [hashtable]$Ts) {
  Step 'A few questions (only the first time)'
  $preset = Read-EnvFile $PresetFile
  foreach ($key in $preset.Keys) { if (-not $Cfg[$key]) { $Cfg[$key] = $preset[$key] } }

  # Friends
  if (-not $Cfg['GUESTS']) {
    Say ''
    Say '     Which friends may join? Each friend opens the Tailscale app and reads their address' White
    Say '     (it starts with 100.). Type one address, press Enter, repeat. Empty line when done (max 4).' White
    $list = @()
    while ($list.Count -lt 4) {
      $entry = (Read-Host "     Friend $($list.Count + 1) Tailscale address").Trim()
      if (-not $entry) { break }
      if (Test-Ipv4 $entry) { $list += $entry } else { Warn 'That does not look like an address like 100.101.102.103' }
    }
    if ($list.Count -eq 0) { Fail 'PassPad needs at least one friend address.' }
    $Cfg['GUESTS'] = ($list -join ',')
  }
  Good "Friends allowed: $($Cfg['GUESTS'])"

  # PS5
  if (-not $Cfg['PS5_HOST_IP']) {
    Say '     Looking for the PS5 on your network (turn it on if it is off) ...' DarkGray
    $ps5 = Find-PS5
    if ($ps5) {
      $Cfg['PS5_HOST_IP'] = $ps5.Ip
      Good "Found $($ps5.Name) at $($ps5.Ip)"
    } else {
      Say '     Could not find it automatically. On the PS5: Settings > Network > View Connection Status > IPv4 Address.' White
      do { $ip = (Read-Host '     PS5 IP address').Trim() } until (Test-Ipv4 $ip)
      $Cfg['PS5_HOST_IP'] = $ip
    }
  }

  $Cfg['HOST_TAILSCALE_IP'] = $Ts.Ip
  if (-not $Cfg['CONSOLE']) { $Cfg['CONSOLE'] = 'chiaki' }
  if (-not $Cfg['TURN_MINUTES']) { $Cfg['TURN_MINUTES'] = '15' }
  if (-not $Cfg['STREAM_RESOLUTION']) { $Cfg['STREAM_RESOLUTION'] = '1080p' }
  if (-not $Cfg['MEDIAMTX_API_USER']) { $Cfg['MEDIAMTX_API_USER'] = 'passpad-api' }
  if (-not $Cfg['MEDIAMTX_API_PASS']) { $Cfg['MEDIAMTX_API_PASS'] = New-Secret }
  Write-EnvFile $EnvFile $Cfg

  $answer = Read-Host '     Put a PassPad shortcut on the desktop? (Y/n)'
  if ($answer -notmatch '^[nN]') { New-Shortcut ([Environment]::GetFolderPath('Desktop')) }
  return $Cfg
}

function New-Shortcut([string]$Folder) {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut((Join-Path $Folder 'PassPad.lnk'))
  $link.TargetPath = Join-Path $Root 'START-PassPad.cmd'
  $link.WorkingDirectory = $Root
  $link.IconLocation = "$env:SystemRoot\System32\joy.cpl,0"
  $link.Description = 'Share the PS5 with friends'
  $link.Save()
  Good "Shortcut added: $Folder\PassPad.lnk"
}

# ---------------------------------------------------------------- firewall

$RuleGroup = 'PassPad'

function Test-Firewall {
  return [bool](Get-NetFirewallRule -Group $RuleGroup -ErrorAction SilentlyContinue)
}

function Ensure-Firewall([string]$BunExe, [string]$MediamtxExe) {
  if (Test-Firewall) { return }
  Step 'Firewall: letting only Tailscale friends in'
  Say '     Windows will ask for permission once: click Yes.' Yellow
  # Allow the two ports from the tailnet only, and block both programs from everything else
  # (a block rule wins over any "allow" someone clicks in a Windows prompt later).
  $script = @"
`$g = '$RuleGroup'
New-NetFirewallRule -Group `$g -DisplayName 'PassPad page (Tailscale only)' -Direction Inbound -Protocol TCP -LocalPort $Port -RemoteAddress $TailnetRange -Action Allow | Out-Null
New-NetFirewallRule -Group `$g -DisplayName 'PassPad video (Tailscale only)' -Direction Inbound -Protocol UDP -LocalPort 8189 -RemoteAddress $TailnetRange -Action Allow | Out-Null
foreach (`$p in @('$BunExe', '$MediamtxExe')) {
  New-NetFirewallRule -Group `$g -DisplayName "PassPad block non-Tailscale (`$([IO.Path]::GetFileName(`$p)))" -Direction Inbound -Program `$p -RemoteAddress @('0.0.0.0-100.63.255.255', '100.128.0.0-255.255.255.255') -Action Block | Out-Null
}
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  try {
    Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList "-NoProfile -EncodedCommand $encoded"
  } catch {
    Fail 'The firewall step needs permission. Run START-PassPad.cmd again and click Yes.'
  }
  if (Test-Firewall) { Good 'Firewall rules added' } else { Fail 'Could not add the firewall rules.' }
}

# ---------------------------------------------------------------- chiaki-ng pairing

function Ensure-Paired([string]$ChiakiExe) {
  $hosts = & $ChiakiExe list 2>$null | Where-Object { $_ -match '^Host:' }
  if ($hosts) { Good "PS5 paired ($(($hosts | Select-Object -First 1) -replace '^Host:\s*', ''))"; return }
  Step 'Pair the PS5 (one time, about 2 minutes)'
  Say '     1. On the PS5: Settings > System > Remote Play > turn on Enable Remote Play.' White
  Say '     2. Same screen: Link Device. The PS5 shows an 8-digit code.' White
  Say '     3. In the chiaki-ng window that opens now: click your PS5 (or the + button),' White
  Say '        sign in with PSN when it asks (that fills in the Account ID), type the 8-digit code.' White
  Say '        Tip: use a free second PSN account so your friends never touch your saves.' DarkGray
  Say '     4. When it says it is registered, close the chiaki-ng window.' White
  Start-Process $ChiakiExe -Wait
  $hosts = & $ChiakiExe list 2>$null | Where-Object { $_ -match '^Host:' }
  if (-not $hosts) { Fail 'The PS5 is not paired yet. Run START-PassPad.cmd again to retry.' }
  Good 'PS5 paired'
}

# ---------------------------------------------------------------- run

function Start-Supervised([string]$Name, [string]$Exe, [string[]]$Arguments, [hashtable]$Env, [string]$Priority) {
  foreach ($key in $Env.Keys) { [Environment]::SetEnvironmentVariable($key, $Env[$key], 'Process') }
  $p = Start-Process -FilePath $Exe -ArgumentList $Arguments -WorkingDirectory $Root -NoNewWindow -PassThru
  if ($Priority) { try { $p.PriorityClass = $Priority } catch { } }
  foreach ($key in $Env.Keys) { [Environment]::SetEnvironmentVariable($key, $null, 'Process') }
  return $p
}

function Get-MediamtxHash([string]$Pass) {
  $sha = [Security.Cryptography.SHA256]::Create()
  return 'sha256:' + [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Pass)))
}

function Run-PassPad {
  Banner
  $ts = Ensure-Tailscale
  $bun = Install-Bun
  $mtx = Install-Mediamtx
  $chiaki = Install-Chiaki

  $cfg = Read-EnvFile $EnvFile
  if (-not $cfg['GUESTS'] -or -not $cfg['PS5_HOST_IP'] -or $Command -eq 'setup') { $cfg = Run-Setup $cfg $ts }
  elseif ($cfg['HOST_TAILSCALE_IP'] -ne $ts.Ip) { $cfg['HOST_TAILSCALE_IP'] = $ts.Ip; Write-EnvFile $EnvFile $cfg }

  Ensure-Firewall $bun $mtx
  Ensure-Paired $chiaki

  if (-not (Test-Path (Join-Path $Root 'node_modules\ws'))) {
    Step 'Installing the server'
    Push-Location $Root
    & $bun install --frozen-lockfile --production | Out-Host
    Pop-Location
  }

  Step 'Starting PassPad'
  $mtxEnv = @{
    MTX_AUTHINTERNALUSERS_1_USER = $cfg['MEDIAMTX_API_USER']
    MTX_AUTHINTERNALUSERS_1_PASS = (Get-MediamtxHash $cfg['MEDIAMTX_API_PASS'])
    MTX_WEBRTCADDITIONALHOSTS = "$($ts.Ip),127.0.0.1"
  }
  $serverEnv = @{ CHIAKI_EXE = $chiaki }
  foreach ($key in $cfg.Keys) { $serverEnv[$key] = $cfg[$key] }

  $mtxProc = Start-Supervised 'video' $mtx @("`"$(Join-Path $Root 'mediamtx\mediamtx.yml')`"") $mtxEnv 'AboveNormal'
  $srvProc = Start-Supervised 'server' $bun @('src/main.ts') $serverEnv 'AboveNormal'
  Start-Sleep 2
  Start-Process "http://127.0.0.1:$Port/#watch"

  Write-Host ''
  Say "   PassPad is running. Friends open:  http://$($ts.Ip):$Port" Green
  Say '   Keep this window open while you play. Close it (or press Ctrl+C) to stop.' DarkGray
  Write-Host ''

  try {
    while ($true) {
      Start-Sleep 3
      if ($mtxProc.HasExited) { Warn 'Video service stopped, restarting'; $mtxProc = Start-Supervised 'video' $mtx @("`"$(Join-Path $Root 'mediamtx\mediamtx.yml')`"") $mtxEnv 'AboveNormal' }
      if ($srvProc.HasExited) { Warn 'Server stopped, restarting'; $srvProc = Start-Supervised 'server' $bun @('src/main.ts') $serverEnv 'AboveNormal' }
    }
  } finally {
    foreach ($p in @($srvProc, $mtxProc)) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
    Get-Process chiaki -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $chiaki } | Stop-Process -Force -ErrorAction SilentlyContinue
  }
}

# ---------------------------------------------------------------- doctor

function Run-Doctor {
  Banner
  Step 'Checking everything'
  $cfg = Read-EnvFile $EnvFile
  $ts = Find-Tailscale
  if (-not $ts) { Warn 'Tailscale is not installed.' } else {
    $ip = (& $ts ip -4 2>$null | Select-Object -First 1)
    if ($ip) { Good "Tailscale signed in ($ip)" } else { Warn 'Tailscale is not signed in.' }
    foreach ($guest in (($cfg['GUESTS'] -split ',') | Where-Object { $_ })) {
      $addr = ($guest -split '=')[-1].Trim()
      $ping = (& $ts ping --c 3 $addr 2>&1) -join ' '
      if ($ping -match 'via DERP') { Warn "$addr reachable but through a relay (slower). Restart Tailscale on both laptops; check the router allows UDP." }
      elseif ($ping -match 'pong') { Good "$addr reachable directly" }
      else { Warn "$addr not reachable. Is your friend's laptop on with Tailscale running?" }
    }
  }
  if ($cfg['PS5_HOST_IP']) {
    if (Test-Connection -Quiet -Count 2 $cfg['PS5_HOST_IP']) { Good "PS5 answers at $($cfg['PS5_HOST_IP'])" }
    else {
      $found = Find-PS5
      if ($found) { Warn "The PS5 moved to $($found.Ip). Run: START-PassPad.cmd setup" } else { Warn 'PS5 not found. Is it on (or in rest mode with network enabled)?' }
    }
  } else { Warn 'Setup not finished yet.' }
  if (Test-Firewall) { Good 'Firewall rules present' } else { Warn 'Firewall rules missing (START-PassPad.cmd adds them).' }
  foreach ($f in @('bun\bun.exe', 'mediamtx\mediamtx.exe', 'chiaki\chiaki.exe')) {
    if (Test-Path (Join-Path $Vendor $f)) { Good "$f present" } else { Warn "$f missing (START-PassPad.cmd downloads it)." }
  }
  $plan = (powercfg /getactivescheme) -join ''
  if ($plan -notmatch 'High performance|Ultimate') { Say '     Tip: plug the laptop in and pick "Best performance" in Windows power settings.' DarkGray }
  Say '     Tip: a network cable from the PS5 to the router makes the stream much smoother.' DarkGray
  Write-Host ''
  Read-Host '  Press Enter to close'
}

# ---------------------------------------------------------------- update / autostart

function Run-Update {
  Banner
  Step 'Checking for a newer PassPad'
  $api = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing
  $current = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
  $latest = $api.tag_name -replace '^v', ''
  if ($latest -eq $current) { Good "You have the newest version ($current)"; Read-Host '  Press Enter to close'; return }
  $asset = $api.assets | Where-Object { $_.name -eq 'passpad-windows.zip' }
  $sum = $api.assets | Where-Object { $_.name -eq 'passpad-windows.zip.sha256' }
  if (-not $asset -or -not $sum) { Fail 'The newest release has no Windows package yet.' }
  $sha = ((Invoke-WebRequest -Uri $sum.browser_download_url -UseBasicParsing).Content -split '\s+')[0]
  $zip = Join-Path $env:TEMP 'passpad-update.zip'
  Get-Verified $asset.browser_download_url $zip $sha
  $tmp = Join-Path $env:TEMP 'passpad-update'
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $zip $tmp -Force
  # Settings, downloads and the PS5 pairing (stored by chiaki-ng in the registry) are kept.
  Get-ChildItem $tmp | Where-Object { $_.Name -notin @('config', 'vendor', 'passpad.env') } | Copy-Item -Destination $Root -Recurse -Force
  Remove-Item (Join-Path $Vendor 'chiaki') -Recurse -Force -ErrorAction SilentlyContinue  # re-downloaded to match
  Remove-Item $zip, $tmp -Recurse -Force
  Good "Updated $current -> $latest"
  Read-Host '  Press Enter to close'
}

function Toggle-Autostart {
  $startup = [Environment]::GetFolderPath('Startup')
  $link = Join-Path $startup 'PassPad.lnk'
  if (Test-Path $link) { Remove-Item $link; Good 'PassPad will no longer start with Windows.' }
  else { New-Shortcut $startup; Good 'PassPad will start when you sign in to Windows.' }
  Read-Host '  Press Enter to close'
}

New-Item -ItemType Directory -Force $LogDir | Out-Null
try { Start-Transcript -Path (Join-Path $LogDir 'starter.log') -Append | Out-Null } catch { }
trap {
  Fail "Unexpected error: $($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))"
}

switch ($Command.ToLower()) {
  'doctor' { Run-Doctor }
  'update' { Run-Update }
  'autostart' { Toggle-Autostart }
  default { Run-PassPad }
}
