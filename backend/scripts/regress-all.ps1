# Full regression on a fresh throw-away database (fsm_test): recreate, migrate, seed, then every suite.
Set-Location (Split-Path $PSScriptRoot -Parent)
node scripts/recreate-test-db.mjs
$env:DATABASE_URL = 'postgresql://fsm:fsm_dev_password@127.0.0.1:54329/fsm_test?schema=public'
npx prisma migrate deploy | Out-Null
npx ts-node prisma/seed.ts | Out-Null
& "$PSScriptRoot\run-suites.ps1" smoke-phase2 smoke-phase3 smoke-phase4 smoke-access smoke-records smoke-requests smoke-schedule smoke-returns smoke-travel smoke-attendance smoke-security
