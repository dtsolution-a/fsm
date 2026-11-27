# Runs the smoke suites against an isolated API on port 3002 and the throw-away database `fsm_test`.
# Usage:  powershell -File scripts\run-suites.ps1 [suite names...]      e.g.  smoke-attendance smoke-phase2
# Needs the dev database (npm run db:dev) to be running. Login is throttled to 10 a minute, so suites wait between runs.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Suites)
if (-not $Suites) { $Suites = @('smoke-attendance') }
Set-Location (Split-Path $PSScriptRoot -Parent)
$env:DATABASE_URL = 'postgresql://fsm:fsm_dev_password@127.0.0.1:54329/fsm_test?schema=public'
npx prisma migrate deploy | Out-Null
$env:UPLOAD_DIR = (Join-Path (Get-Location) 'uploads-test')
$env:API = 'http://localhost:3002/api/v1'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'node'; $psi.Arguments = 'dist/main.js'; $psi.UseShellExecute = $false
$psi.EnvironmentVariables['DATABASE_URL'] = $env:DATABASE_URL
$psi.EnvironmentVariables['PORT'] = '3002'
$psi.EnvironmentVariables['UPLOAD_DIR'] = (Join-Path (Get-Location) 'uploads-test')
$psi.EnvironmentVariables['ROUTING_URL'] = 'none'
$psi.EnvironmentVariables['GEOCODER'] = 'fake'
$api = [System.Diagnostics.Process]::Start($psi)
try {
  for ($i = 0; $i -lt 40; $i++) { try { Invoke-RestMethod http://localhost:3002/api/v1/health | Out-Null; break } catch { Start-Sleep 1 } }
  $first = $true
  foreach ($s in $Suites) {
    if (-not $first) { Start-Sleep 62 }
    $first = $false
    Write-Host "== $s"
    node "scripts/$s.mjs" | Select-Object -Last 40
  }
} finally { if (-not $api.HasExited) { $api.Kill() } }
