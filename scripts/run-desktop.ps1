<#
.SYNOPSIS
  One command to launch the full NodeScope stack + the 3D desktop app on Windows.

.DESCRIPTION
  PowerShell port of scripts/run-desktop.sh. Automates SETUP.md end-to-end:
  infra (Postgres/Redis/MinIO via Docker Desktop) -> .env + SECRET_ENCRYPTION_KEY ->
  migrate -> seed -> load FZK-Haus sample model -> API (:3000) + web (:8081) each in
  their own window -> Electron 3D viewer. Idempotent: anything already up is skipped.

  Run it from inside the repo. Needs Node >= 20, Docker Desktop (running), and a real
  display + GPU (native Windows). If PowerShell blocks the script, either run
  'Set-ExecutionPolicy -Scope CurrentUser RemoteSigned' once, or launch it with
  'powershell -ExecutionPolicy Bypass -File .\scripts\run-desktop.ps1'.

.PARAMETER Reset        Wipe + re-migrate + re-seed the DB first.
.PARAMETER NoModel      Skip loading the FZK-Haus sample model.
.PARAMETER DesktopOnly  Backend already up elsewhere; just open the desktop.
.PARAMETER BackendOnly  Start infra + API + web, leave them running, no GUI.
.PARAMETER Stop         Stop the API/web windows this script started.

.EXAMPLE  .\scripts\run-desktop.ps1
.EXAMPLE  .\scripts\run-desktop.ps1 -Reset
.EXAMPLE  .\scripts\run-desktop.ps1 -Stop
#>
[CmdletBinding()]
param(
  [switch]$Reset,
  [switch]$NoModel,
  [switch]$DesktopOnly,
  [switch]$BackendOnly,
  [switch]$Stop
)

# Default ErrorActionPreference (Continue): native tools (git/npm/docker) write to
# stderr on benign output, and 'Stop' would abort on that. We check $LASTEXITCODE.

# --- locate repo root (script in scripts/ or repo root) ---
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if     (Test-Path (Join-Path $scriptDir 'package.json'))      { $root = $scriptDir }
elseif (Test-Path (Join-Path $scriptDir '..\package.json'))   { $root = (Resolve-Path (Join-Path $scriptDir '..')).Path }
else   { $root = (Get-Location).Path }
Set-Location $root

$runDir = Join-Path $root '.run'
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$script:startedServices = @()

function Log  ($m) { Write-Host ">> $m" -ForegroundColor Cyan }
function Warn ($m) { Write-Host "!  $m" -ForegroundColor Yellow }
function Die  ($m) { Write-Host "X  $m" -ForegroundColor Red; exit 1 }

function Test-Port($p) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $p); $c.Close(); return $true }
  catch { return $false }
}
function Wait-Port($p, $name, $timeoutSec = 120) {
  Log "waiting for $name on :$p ..."
  $t = 0
  while (-not (Test-Port $p)) {
    Start-Sleep -Seconds 1; $t++
    if ($t -ge $timeoutSec) { Die "$name never came up on :$p (${timeoutSec}s); check its window / $runDir" }
  }
  Log "$name up on :$p"
}
function Start-ServiceWindow($name, $cmdline) {
  $p = Start-Process cmd.exe -WorkingDirectory $root -ArgumentList "/k $cmdline" -PassThru
  Set-Content -Path (Join-Path $runDir "$name.pid") -Value $p.Id
  $script:startedServices += $name
  Log "started $name (pid $($p.Id)) in its own window"
}
function Stop-Svc($name) {
  $f = Join-Path $runDir "$name.pid"
  if (Test-Path $f) {
    taskkill /PID (Get-Content $f) /T /F 2>$null | Out-Null
    Remove-Item $f -Force
    Log "stopped $name"
  }
}

# --- -Stop ---
if ($Stop) {
  Stop-Svc 'api'; Stop-Svc 'web'
  Log "infra left running ('docker compose down' to stop it)"
  exit 0
}

# --- preconditions ---
foreach ($exe in 'node', 'npm') {
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { Die "$exe not found (need Node >= 20)" }
}
$doInfra = -not $DesktopOnly
if ($doInfra -and -not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Die "docker not found (Docker Desktop needed; or use -DesktopOnly)"
}

# --- deps ---
if (-not (Test-Path 'node_modules')) {
  Log "installing dependencies (first run, a few minutes) ..."
  npm install
  if ($LASTEXITCODE -ne 0) { Die "npm install failed" }
}

# --- .env + SECRET_ENCRYPTION_KEY ---
if (-not (Test-Path '.env')) { Log "creating .env from .env.example"; Copy-Item '.env.example' '.env' }
$envText = Get-Content '.env' -Raw
if ($envText -notmatch '(?m)^SECRET_ENCRYPTION_KEY=(?!CHANGE_ME).+$') {
  $key = (node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')
  if ($envText -match '(?m)^SECRET_ENCRYPTION_KEY=') {
    $envText = [regex]::Replace($envText, '(?m)^SECRET_ENCRYPTION_KEY=.*$', "SECRET_ENCRYPTION_KEY=$key")
  } else {
    $envText = $envText.TrimEnd() + "`r`nSECRET_ENCRYPTION_KEY=$key`r`n"
  }
  Set-Content -Path '.env' -Value $envText -NoNewline
  Log "generated SECRET_ENCRYPTION_KEY"
}

# --- infra ---
if ($doInfra) {
  if ((Test-Port 5432) -and (Test-Port 6379) -and (Test-Port 9000)) {
    Log "infra already up (5432/6379/9000) - skipping docker compose"
  } else {
    Log "starting infra (Postgres/Redis/MinIO) ..."
    docker compose up -d --wait
    if ($LASTEXITCODE -ne 0) { Die "docker compose failed - is Docker Desktop running?" }
  }
}

# --- database ---
if (-not $DesktopOnly) {
  if ($Reset) {
    Log "resetting DB (drop + migrate + seed) ..."; npm run db:reset
    if ($LASTEXITCODE -ne 0) { Die "db:reset failed" }
    $NoModel = $false
  } else {
    Log "applying migrations ..."; npm run db:migrate
    if ($LASTEXITCODE -ne 0) { Die "db:migrate failed" }
    Log "seeding demo data ..."; npm run db:seed
    if ($LASTEXITCODE -ne 0) { Warn "db:seed reported an issue (usually: already seeded) - continuing" }
  }
}

# --- API (:3000) ---
if (-not $DesktopOnly) {
  if (Test-Port 3000) { Log "API already up on :3000 - skipping" }
  else { Start-ServiceWindow 'api' 'npm run dev:api'; Wait-Port 3000 'API' 120 }
}

# --- sample model (so the viewport isn't empty) ---
if (-not $DesktopOnly -and -not $NoModel) {
  Log "loading sample building (FZK-Haus) - needs internet on first run ..."
  npm run load-sample-model
  if ($LASTEXITCODE -ne 0) { Warn "load-sample-model failed - viewer may be empty (retry: npm run load-sample-model)" }
}

# --- web (:8081 - required for the desktop's browser PKCE sign-in) ---
if (-not $DesktopOnly) {
  if (Test-Port 8081) { Log "web already up on :8081 - skipping" }
  else { Start-ServiceWindow 'web' 'npm run dev:web'; Wait-Port 8081 'web' 120 }
}

# --- desktop (foreground GUI) ---
if (-not $BackendOnly) {
  Write-Host ""
  Write-Host "== Sign in: owner@acme.test / devpassword123 ==" -ForegroundColor Green
  Write-Host "   In the viewer (open Main Building), verify:" -ForegroundColor Green
  Write-Host "     1) NO-FREEZE  spinner keeps animating through the parse"
  Write-Host "     2) PICKING    click an element -> Inspector populates"
  Write-Host "     3) BCF        Issues panel -> a viewpoint restores camera + visibility"
  Write-Host ""
  Log "launching desktop (dev:desktop) - close the window to stop everything this script started"
  npm run dev:desktop
  # desktop closed -> stop the api/web windows we started
  foreach ($name in $script:startedServices) { Stop-Svc $name }
} else {
  Log "backend up: API http://localhost:3000  -  web http://localhost:8081"
  Log "stop later:  .\scripts\run-desktop.ps1 -Stop   (infra: docker compose down)"
}
