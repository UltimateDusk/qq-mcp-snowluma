# Copy to config/local.ps1 or run scripts/setup.ps1 to generate it.
$env:QQ_EXPECTED_ACCOUNT = '100001'
$env:QQ_ONEBOT_CONFIG = 'D:\SnowLuma\app\config\onebot_100001.json'
$env:QQ_MCP_DATA_DIR = "$PSScriptRoot\..\data"
$env:QQ_OUTBOX_DIR = "$PSScriptRoot\..\outbox"
$env:QQ_MCP_HTTP_PORT = '3010'
$env:QQ_MCP_AUTH_FILE = "$PSScriptRoot\..\data\http-authorization.txt"
$env:QQ_MCP_NODE = 'D:\SnowLuma\app\node.exe'

# Optional settings:
# $env:QQ_API_TIMEOUT_MS = '15000'
# $env:QQ_SEND_DELAY_MIN_MS = '5000'
# $env:QQ_SEND_DELAY_MAX_MS = '13000'
# $env:QQ_MEDIA_ROOTS = 'D:\SnowLuma\app\cache'
