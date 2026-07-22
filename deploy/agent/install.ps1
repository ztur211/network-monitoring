# NodeScope Agent - Windows installer, served by the appliance at /agent/install.ps1.
#
# Usage (elevated PowerShell):
#   iwr http://<server>/agent/install.ps1 -OutFile install.ps1
#   .\install.ps1 -Server http://<server> -Code <enroll-code>
#
# Downloads the agent from the same appliance, verifies sha256 (and the
# publisher signature where PowerShell 7+ / .NET is available), installs it,
# enrolls, and registers a startup task that keeps the agent running. The
# runner loop restarts on ANY exit - the self-updater exits 0 after swapping
# its binary and relies on that restart, mirroring systemd Restart=always.
param(
  [Parameter(Mandatory = $true)]
  [string]$Server,

  [string]$Code = "",
  [string]$InstallDir = "C:\Program Files\NodeScope",
  [string]$DataDir = "C:\ProgramData\NodeScope",
  [string]$TaskName = "NodeScopeAgent"
)

$ErrorActionPreference = "Stop"
$Server = $Server.TrimEnd("/")

# The NodeScope agent publisher key (must match SelfUpdate.cs).
$PublicKeyPem = @"
-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAERu82LnwHi9fVXevrloVhU73HeZcG
O8vPFg8UsNyWcytI10CtnPz/KvlUPRsRdPU+4U5PMgnguurkmBI9Xkwlag==
-----END PUBLIC KEY-----
"@

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "This script must be run as Administrator."
  exit 1
}

$file = "nodescope-agent-win-x64.exe"
$exePath = Join-Path $InstallDir "nodescope-agent.exe"
$credentialsPath = Join-Path $DataDir "credentials.json"
$tmp = Join-Path $env:TEMP "nodescope-agent-install"
New-Item -ItemType Directory -Path $tmp, $InstallDir, $DataDir -Force | Out-Null

Write-Host "[1/5] Downloading $file from $Server/agent/ ..."
Invoke-WebRequest -Uri "$Server/agent/$file" -OutFile "$tmp\$file"
Invoke-WebRequest -Uri "$Server/agent/$file.sha256" -OutFile "$tmp\$file.sha256"
Invoke-WebRequest -Uri "$Server/agent/$file.sig" -OutFile "$tmp\$file.sig"

Write-Host "[2/5] Verifying checksum and publisher signature..."
$expected = (Get-Content "$tmp\$file.sha256" -Raw).Split(" ")[0].Trim().ToLowerInvariant()
$actual = (Get-FileHash -Algorithm SHA256 "$tmp\$file").Hash.ToLowerInvariant()
if ($expected -ne $actual) {
  Write-Error "Checksum mismatch: expected $expected, got $actual"
  exit 1
}
$ecdsa = $null
try {
  $ecdsa = [System.Security.Cryptography.ECDsa]::Create()
  $ecdsa.ImportFromPem($PublicKeyPem)
} catch {
  # Windows PowerShell 5.1 lacks ImportFromPem; the checksum still gates the install.
  $ecdsa = $null
  Write-Warning "Signature check skipped (needs PowerShell 7+); checksum verified."
}
if ($null -ne $ecdsa) {
  $payload = [System.IO.File]::ReadAllBytes("$tmp\$file")
  $signature = [System.IO.File]::ReadAllBytes("$tmp\$file.sig")
  $valid = $ecdsa.VerifyData($payload, $signature,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.DSASignatureFormat]::Rfc3279DerSequence)
  if (-not $valid) {
    Write-Error "Publisher signature verification FAILED - refusing to install."
    exit 1
  }
  Write-Host "  OK: binary is authentic"
}

Write-Host "[3/5] Installing $exePath ..."
Copy-Item "$tmp\$file" -Destination $exePath -Force

Write-Host "[4/5] Enrolling agent..."
$env:NODESCOPE_AGENT_CREDENTIALS = $credentialsPath
if ($Code -ne "") {
  & $exePath enroll --code $Code --url "$Server/api"
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Enrollment failed (exit code $LASTEXITCODE)"
    exit 1
  }
} elseif (Test-Path $credentialsPath) {
  Write-Host "Already enrolled ($credentialsPath exists) - keeping credentials."
} else {
  Write-Error "Not enrolled and no -Code given. Generate an enrollment code in the web UI."
  exit 1
}

Write-Host "[5/5] Registering the startup task..."
# The loop restarts the agent after self-update (exit 0) and after crashes alike.
$runner = Join-Path $InstallDir "run-agent.cmd"
@"
@echo off
set NODESCOPE_AGENT_API_URL=$Server/api
set NODESCOPE_AGENT_CREDENTIALS=$credentialsPath
set NODESCOPE_AGENT_QUEUE=$DataDir\queue.jsonl
:loop
"$exePath"
timeout /t 5 /nobreak > nul
goto loop
"@ | Set-Content -Path $runner -Encoding ASCII

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute $runner
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "nodescope-agent installed and running as scheduled task '$TaskName'."
