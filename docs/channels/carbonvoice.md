---
summary: "Carbon Voice channel plugin — PAT websocket, optional webhooks, and text replies"
read_when:
  - Configuring or debugging the Carbon Voice channel
title: "Carbon Voice"
---

# Carbon Voice

The Carbon Voice channel lets OpenClaw receive inbound messages over a **realtime websocket** (authenticated with your agent PAT) and reply using [`POST /v3/messages/start`](https://api.carbonvoice.app/docs) (Carbon Voice turns text into voice on their side).

You can optionally add **public webhooks** so Carbon Voice also delivers [`message.posted.to.channel`](https://api.carbonvoice.app/docs) events to your gateway. Webhook and websocket paths share the same dedupe and dispatch logic.

## Requirements

- **Agent PAT** — Carbon Voice agent personal access token (`cv_pat_...`). For the default account you can set the **`AGENT_PAT`** environment variable, or set `channels.carbonvoice.accounts.<id>.apiKey` in config to the same token. The API client sends Bearer auth for PATs.
- **API baseUrl** — typically `https://api.carbonvoice.app`.

### PAT-only (no public URL)

With only a PAT and `baseUrl`, OpenClaw stays configured. On gateway start it:

1. Calls `GET /whoami` to learn the PAT identity’s user id.
2. Connects a Socket.IO websocket to `baseUrl` (same auth headers as the REST client).
3. On each `message:created` event, loads message details and dispatches inbound replies.
4. On each websocket **connect**, calls **`POST /v3/messages/recent`** with `direction: "newer"` to catch messages missed while disconnected (first connect uses a short lookback window; after a disconnect it uses the disconnect time as the cursor).

Inbound filtering matches webhook subscribe semantics: messages from your own PAT user id are ignored, and optional **`creatorId`** limits inbound to that Carbon Voice user id.

### Optional webhooks

If you set **`publicWebhookBaseUrl`** (public origin of your OpenClaw gateway, no path), reachable by Carbon Voice:

- **`webhookPath`** — path on the gateway; default is `/openclaw/carbonvoice/webhook` when a public base URL is set.

On gateway start, OpenClaw then also:

1. Registers the plugin HTTP route at `webhookPath`.
2. Calls `POST /apps/subscribe` with `message.posted.to.channel` and the same creator filters as above.

The websocket still runs so delivery stays timely even when webhooks lag.

## Configuration

Example with **optional** webhook fields:

```json5
{
  channels: {
    carbonvoice: {
      accounts: {
        default: {
          enabled: true,
          baseUrl: "https://api.carbonvoice.app",
          // Optional: public origin for Carbon Voice webhooks
          publicWebhookBaseUrl: "https://gateway.example.com",
          webhookPath: "/openclaw/carbonvoice/webhook",
          // Optional: only allow this Carbon Voice user id to trigger the agent
          creatorId: "optional-creator-user-id",
          // Optional: verify Carbon Voice webhook auth header (must match app settings)
          webhookAuthHeaderName: "x-api-key",
          webhookAuthHeaderValue: "shared-webhook-secret",
        },
      },
    },
  },
}
```

For the default account you may supply the PAT with **`AGENT_PAT`** instead of `apiKey` in config.

## Outbound targets

`openclaw message send` / agent tools should use the **channel (conversation) id** as the `to` value — the same `channel_guid` Carbon Voice uses in message payloads.

## Docs links

- [AI Agent Guide (Notion)](https://phononx.notion.site/AI-Agent-Guide-31ec208443e280a6bb2bcc89339832bc)
- [OpenAPI](https://api.carbonvoice.app/docs-json)

https://docs.openclaw.ai/channels/carbonvoice
