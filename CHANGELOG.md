# Changelog

## 1.7.0 - 2026-11-02

- Extended existing flows with explicit 60-second rolling renewal, replay-resistant activity checks, an absolute maximum, and AI-only wind-down hints. Hard/soft duration semantics remain supported.
- Added default 8–40 second length/activity-aware send pacing and reason/timing diagnostics.
- Added bounded message batching, chronological cursors with separate priority hints, and automatic reply context.
- Added guarded image source fallback and bounded URL refresh while retaining existing GIF frame previews.
- Persisted the bounded event cache and acknowledged flow cursor for recovery, preserving explicit history-gap warnings.
- Added optional private typing and explicit idle/human_left/ai_only_loop/manual_end reasons.
- Added mock transport, actual process restart, renewal replay, batching, priority, media fallback and pacing regression coverage.

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
