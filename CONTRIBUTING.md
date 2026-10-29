# Contributing

1. Fork the repository and create a focused branch.
2. Never commit real QQ numbers, group IDs, friend IDs, message contents, tokens, local paths, logs or files under `data/`.
3. Run `npm ci` and `npm test` before opening a pull request.
4. Tests that write to a real QQ account are not accepted in CI. Use the existing mock HTTP/WebSocket fixtures.
5. Keep `request_id`, reply claim and flow lease guarantees backward compatible. A change that can duplicate an outbound message must include a failure-mode test.

Bug reports should include the MCP version, Node version, SnowLuma version, redacted error text and whether the failure happened before dispatch, after dispatch or with an unknown result.
