# NodeScope Agent - Windows installer
# Usage: .\install-windows.ps1 -Url <api-url> -Code <enroll-code>
# Requirements: Administrator privileges, Windows 7+ / Server 2008+

param(
  [Parameter(Mandatory=$true)]
  [string]$Url,

  [Parameter(Mandatory=$true)]
  [string]$Code,

  [string]$BinaryUrl = "",
  [string]$InstallPath = "C:\Program Files\NodeScope\nodescope-agent.exe",
  [string]$ServiceName = "NodeScopeAgent",
  [string]$ServiceDisplayName = "NodeScope Agent"
)

$ErrorActionPreference = "Stop"

# Require Administrator
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "This script must be run as Administrator."
  exit 1
}

Write-Host "[1/4] Installing nodescope-agent binary..."
$installDir = Split-Path -Parent $InstallPath
New-Item -ItemType Directory -Path $installDir -Force | Out-Null

if ($BinaryUrl -ne "") {
  Invoke-WebRequest -Uri $BinaryUrl -OutFile $InstallPath
} else {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
  Copy-Item "$scriptDir\..\dist\nodescope-agent.exe" -Destination $InstallPath -Force
}

Write-Host "[2/4] Enrolling agent..."
& "$InstallPath" enroll --code $Code --url $Url
if ($LASTEXITCODE -ne 0) {
  Write-Error "Enrollment failed (exit code $LASTEXITCODE)"
  exit 1
}

Write-Host "[3/4] Installing Windows service..."
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
  Write-Host "Stopping existing service..."
  Stop-Service -Name $ServiceName -Force
  & sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 2
}

& sc.exe create $ServiceName binPath= "`"$InstallPath`"" start= auto DisplayName= $ServiceDisplayName
& sc.exe description $ServiceName "NodeScope network monitoring agent — collects device reachability metrics and forwards to the NodeScope platform."
& sc.exe failure $ServiceName reset= 60 actions= restart/5000/restart/10000/restart/30000

Write-Host "[4/4] Starting service..."
Start-Service -Name $ServiceName
$svc = Get-Service -Name $ServiceName
Write-Host "Service status: $($svc.Status)"

Write-Host "nodescope-agent installed and running. Logs via: Get-EventLog -LogName Application -Source NodeScopeAgent"
