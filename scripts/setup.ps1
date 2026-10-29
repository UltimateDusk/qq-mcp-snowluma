param(
    [Parameter(Mandatory = $true)]
    [string]$SnowLumaRoot,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{5,20}$')]
    [string]$Account,

    [ValidateRange(1, 65535)]
    [int]$McpPort = 3010
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$snowRoot = (Resolve-Path -LiteralPath $SnowLumaRoot).Path
$oneBotConfig = Join-Path $snowRoot "app\config\onebot_$Account.json"
$bundledNode = Join-Path $snowRoot 'app\node.exe'

if (-not (Test-Path -LiteralPath $oneBotConfig -PathType Leaf)) {
    throw "Cannot find $oneBotConfig. Connect this QQ account in SnowLuma WebUI and save its OneBot configuration first."
}

$oneBot = Get-Content -LiteralPath $oneBotConfig -Raw | ConvertFrom-Json
$httpServer = $oneBot.networks.httpServers | Where-Object { $_.name -eq 'qq-mcp-local' -and $_.enabled }
$wsServer = $oneBot.networks.wsServers | Where-Object { $_.name -eq 'qq-mcp-events' -and $_.enabled }
if (-not $httpServer) { throw 'SnowLuma is missing an enabled HTTP server named qq-mcp-local.' }
if (-not $wsServer) { throw 'SnowLuma is missing an enabled WebSocket server named qq-mcp-events.' }
foreach ($server in @($httpServer, $wsServer)) {
    if ($server.host -notin @('127.0.0.1', 'localhost')) { throw "OneBot server $($server.name) must listen on 127.0.0.1 only." }
    if (-not $server.accessToken) { throw "OneBot server $($server.name) must have an access token." }
}

$dataDir = Join-Path $projectRoot 'data'
$outboxDir = Join-Path $projectRoot 'outbox'
$configDir = Join-Path $projectRoot 'config'
New-Item -ItemType Directory -Force -Path $dataDir, $outboxDir, $configDir | Out-Null

$authFile = Join-Path $dataDir 'http-authorization.txt'
if (-not (Test-Path -LiteralPath $authFile)) {
    $bytes = [byte[]]::new(32)
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $token = 'Bearer ' + (([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant())
    [IO.File]::WriteAllText($authFile, $token, [Text.UTF8Encoding]::new($false))
    [Array]::Clear($bytes, 0, $bytes.Length)
}

$nodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
$escape = { param($value) $value.Replace("'", "''") }
$localConfig = @"
`$env:QQ_EXPECTED_ACCOUNT = '$Account'
`$env:QQ_ONEBOT_CONFIG = '$(& $escape $oneBotConfig)'
`$env:QQ_MCP_DATA_DIR = '$(& $escape $dataDir)'
`$env:QQ_OUTBOX_DIR = '$(& $escape $outboxDir)'
`$env:QQ_MCP_HTTP_PORT = '$McpPort'
`$env:QQ_MCP_AUTH_FILE = '$(& $escape $authFile)'
`$env:QQ_MCP_NODE = '$(& $escape $nodePath)'
"@
[IO.File]::WriteAllText((Join-Path $configDir 'local.ps1'), $localConfig, [Text.UTF8Encoding]::new($false))

Push-Location $projectRoot
try {
    Get-Command npm -ErrorAction Stop | Out-Null
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. Install Node.js 24 and npm, then retry.' }
} finally {
    Pop-Location
}

Write-Host 'Setup completed.' -ForegroundColor Green
Write-Host 'Next: .\scripts\start-http.ps1'
Write-Host "MCP endpoint: http://127.0.0.1:$McpPort/mcp"
Write-Host 'The HTTP bearer was written to data/http-authorization.txt. Do not commit or share it.'
