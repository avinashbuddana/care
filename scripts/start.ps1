# Windows: build and start everything (redis, migrations, admin seed, api, worker, web/admin panel, superset).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (-not (Test-Path .env)) {
  docker volume inspect powerbridge_postgres *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-Error 'No .env, but the database volume from an earlier run exists - new random passwords would not match it. Restore the old .env, or wipe the Docker data (database, redis, uploads): docker compose down -v'
    exit 1
  }
  # First run: .env from the template, with random DB passwords and secret keys.
  function Rnd { $b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') }) }
  $t = Get-Content .env.example -Raw
  $t = $t.Replace('CHANGE_ME_app', (Rnd)).Replace('CHANGE_ME_reporting', (Rnd)).Replace('CHANGE_ME_superset', (Rnd))
  $t = $t -replace '(?m)^SECRET_ENCRYPTION_KEY=.*', ('SECRET_ENCRYPTION_KEY=' + (Rnd) + (Rnd).Substring(0, 16))
  $t = $t -replace '(?m)^SUPERSET_SECRET_KEY=.*', ('SUPERSET_SECRET_KEY=' + (Rnd))
  [IO.File]::WriteAllText((Join-Path $PWD '.env'), $t.Replace("`r`n", "`n"))
  Write-Host 'Created .env from .env.example (random DB passwords and secrets).'
}
$placeholders = Select-String -Path .env -Pattern 'CHANGE_ME|REPLACE_|your-db-host|replace-with' | Where-Object { $_.Line -notmatch '^\s*#' }
if ($placeholders) { Write-Warning ".env still has placeholder values:"; $placeholders | ForEach-Object { Write-Warning $_.Line } }
docker compose up -d --build @args
if ($LASTEXITCODE -ne 0) { Write-Error 'docker compose up failed - see: docker compose logs migrate seed superset-init'; exit $LASTEXITCODE }
docker compose ps
function EnvVal($name, $default) {
  $line = Select-String -Path .env -Pattern "^$name=" | Select-Object -Last 1
  if ($line) { $line.Line.Split('=', 2)[1] } else { $default }
}
Write-Host ""
Write-Host "Web app:     http://localhost:$(EnvVal WEB_PORT 3000)/   (log in; admin pages are under /admin/...)"
Write-Host "API docs:    http://localhost:$(EnvVal API_PORT 3001)/api/docs"
Write-Host "Superset:    http://localhost:$(EnvVal SUPERSET_PORT 8088)"
Write-Host "Logs:        docker compose logs -f api worker web superset"
