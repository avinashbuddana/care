# Windows: build and start everything (redis, migrations, admin seed, api, worker, web/admin panel, superset).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (-not (Test-Path .env)) { Write-Error 'Missing .env - copy .env.example to .env and fill it in.'; exit 1 }
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
Write-Host "Admin panel: http://localhost:$(EnvVal WEB_PORT 3000)/admin"
Write-Host "API docs:    http://localhost:$(EnvVal API_PORT 3001)/api/docs"
Write-Host "Superset:    http://localhost:$(EnvVal SUPERSET_PORT 8088)"
Write-Host "Logs:        docker compose logs -f api worker web superset"
