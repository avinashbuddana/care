# Windows: stop and remove the app containers. Postgres keeps running (and all volumes are kept).
# To stop Postgres as well: docker compose down
Set-Location (Join-Path $PSScriptRoot '..')
$services = docker compose config --services | Where-Object { $_ -ne 'postgres' }
docker compose rm --stop --force @services
