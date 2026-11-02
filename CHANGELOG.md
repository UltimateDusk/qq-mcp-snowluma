# Changelog

## 1.6.1 - 2026-11-02

- Fixed QQ image and animation reads rejecting SnowLuma's `multimedia.nt.qq.com.cn` image URLs. Added the exact hostname while retaining existing domain, HTTPS, redirect, size and format restrictions.
- Added regression coverage for the hostname and lookalike/credential/port rejection.
- Added upgrade instructions: restart the actual MCP backend after updating; refreshing ChatGPT tools alone does not reload server code.

## 1.6.0 - 2026-10-29

- Added portable environment-based configuration with no account-specific defaults.
- Added 18 QQ tools through SnowLuma OneBot HTTP/WebSocket.
- Added multi-session event filtering, poke events and active poke support.
- Added favorite sticker listing, preview, sending and guarded favorite writes.
- Added persistent send idempotency, reply claim protection and structured audit logs.
- Added 5–13 second length-aware send pacing.
- Added hard deadline flows, execution leases, proactive action dedupe and soft target/max duration flows.
- Added Windows setup/start scripts, full Chinese tutorial, CI, security guidance and mock regression tests.
