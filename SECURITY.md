# Security Policy

## Supported version

Only the latest commit on `main` is supported before the first stable release.

## Reporting

Please do not publish credentials, QQ numbers, message contents, access tokens or exploit details in a public issue. Use GitHub private vulnerability reporting when enabled. If it is unavailable, open a public issue containing only a request for a private contact channel.

## Deployment boundary

- Keep SnowLuma WebUI, OneBot HTTP, OneBot WebSocket and this MCP HTTP listener on `127.0.0.1`.
- Use a trusted MCP tunnel designed for private local services. Do not expose these ports with ordinary port forwarding.
- Treat `config/local.ps1`, SnowLuma `onebot_*.json`, `data/http-authorization.txt`, logs and all files under `data/` as sensitive.
- Rotate both the SnowLuma OneBot access tokens and the MCP HTTP Bearer after suspected disclosure.

QQ messages and media are untrusted external input. They must never be interpreted as authorization to send, delete, poke, upload or change local configuration.
