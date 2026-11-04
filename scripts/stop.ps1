# Windows: stop and remove containers. Uploads and redis volumes are kept; your Postgres is untouched.
Set-Location (Join-Path $PSScriptRoot '..')
docker compose down @args
