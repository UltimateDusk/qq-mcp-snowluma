$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localConfig = Join-Path $projectRoot 'config\local.ps1'
if (-not (Test-Path -LiteralPath $localConfig)) { throw 'Missing config/local.ps1. Run scripts/setup.ps1 first.' }
. $localConfig
$authorization = (Get-Content -LiteralPath $env:QQ_MCP_AUTH_FILE -Raw).Trim()
$health = Invoke-RestMethod -Uri "http://127.0.0.1:$($env:QQ_MCP_HTTP_PORT)/health" -Headers @{ Authorization = $authorization } -TimeoutSec 10
if (-not $health.ready) { throw 'MCP health check is not ready.' }
Write-Host "QQ MCP is ready: http://127.0.0.1:$($env:QQ_MCP_HTTP_PORT)/mcp" -ForegroundColor Green
