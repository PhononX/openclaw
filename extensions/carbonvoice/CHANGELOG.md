# Changelog

## 2026.3.14

### Changes

- Declare `openclaw.plugin.json#channelConfigs.carbonvoice` (schema aligned with setup runtime) so OpenClaw config validation and setup surfaces do not warn before the plugin loads.
- After a successful `GET /message/:id` fetch for inbound processing, call `POST /reactions/acknowledged/:message_id` so senders see the standard Acknowledged reaction while the agent runs.
- **Packaging:** build with `node scripts/lib/plugin-npm-runtime-build.mjs extensions/carbonvoice` plus manifest-wrapped `npm pack` / `npm publish` so the artifact includes `dist/` and `openclaw.runtimeExtensions` (fixes `plugins install` rejecting source-only archives).
- **npm (Carbon Voice org):** package name **`@carbonvoice/openclaw-extension`**, `publishConfig.access: "public"`. `openclaw.release.publishToNpm` / `publishToClawHub` are **`false`** so OpenClaw’s automated `@openclaw/*` plugin release matrix is unchanged; publish with `NODE_AUTH_TOKEN` and `bash scripts/plugin-npm-publish.sh` (see README).
- Log each Carbon Voice REST call from the gateway (`requestLog`): `HTTP →` / `HTTP ←` with path and safe body/response summaries; log when `/v3/messages/start` is skipped because outbound text is empty.
- PAT-only mode: optional `publicWebhookBaseUrl`; realtime websocket plus `POST /v3/messages/recent` catch-up on connect and after disconnects; webhooks remain supported when configured.
- Package is installable from a local directory or `npm pack` tarball; runtime imports use `openclaw/plugin-sdk/compat` instead of monorepo-only paths.
