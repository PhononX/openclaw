# Changelog

## 2026.3.14

### Changes

- After a successful `GET /message/:id` fetch for inbound processing, call `POST /reactions/acknowledged/:message_id` so senders see the standard Acknowledged reaction while the agent runs.
- **Packaging:** `openclaw.release.publishToNpm` is enabled so `node scripts/lib/plugin-npm-runtime-build.mjs extensions/carbonvoice` plus the manifest-wrapped `npm pack` produce an installable tarball with `dist/` and `runtimeExtensions` (fixes `plugins install` rejecting source-only archives).
- Log each Carbon Voice REST call from the gateway (`requestLog`): `HTTP →` / `HTTP ←` with path and safe body/response summaries; log when `/v3/messages/start` is skipped because outbound text is empty.
- PAT-only mode: optional `publicWebhookBaseUrl`; realtime websocket plus `POST /v3/messages/recent` catch-up on connect and after disconnects; webhooks remain supported when configured.
- Package is installable from a local directory or `npm pack` tarball; runtime imports use `openclaw/plugin-sdk/compat` instead of monorepo-only paths.
