$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localConfig = Join-Path $projectRoot 'config\local.ps1'
if (-not (Test-Path -LiteralPath $localConfig)) { throw 'Missing config/local.ps1. Run scripts/setup.ps1 first.' }
. $localConfig
Remove-Item Env:QQ_MCP_HTTP_PORT -ErrorAction SilentlyContinue
Set-Location -LiteralPath $projectRoot
& $env:QQ_MCP_NODE (Join-Path $projectRoot 'server.mjs')
exit $LASTEXITCODE
