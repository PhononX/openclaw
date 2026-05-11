---
summary: "Carbon Voice channel plugin — API webhooks and text replies"
read_when:
  - Configuring or debugging the Carbon Voice channel
title: "Carbon Voice"
---

# Carbon Voice

The Carbon Voice channel lets OpenClaw receive [message.posted.to.channel](https://api.carbonvoice.app/docs) webhooks and reply using [`POST /v3/messages/start`](https://api.carbonvoice.app/docs) (Carbon Voice turns text into voice on their side).

## Requirements

- **Agent PAT** — Carbon Voice agent personal access token (`cv_pat_...`). For the default account you can set the **`AGENT_PAT`** environment variable, or set `channels.carbonvoice.accounts.<id>.apiKey` in config to the same token. The API client sends Bearer auth for PATs.
- **API baseUrl** — typically `https://api.carbonvoice.app`.
- **publicWebhookBaseUrl** — public origin of your OpenClaw gateway host (no path), reachable by Carbon Voice.
- **webhookPath** — path registered on the gateway; default is `/openclaw/carbonvoice/webhook`.

On gateway start, OpenClaw:

1. Calls `GET /whoami` to learn the PAT identity’s user id.
2. Registers the plugin HTTP route at `webhookPath`.
3. Calls `POST /apps/subscribe` with `message.posted.to.channel` and filters so the bot’s own messages are excluded (`creator_id` `ne` your user id from whoami). If **`creatorId`** is set in config, an additional `creator_id` `eq` filter limits inbound to that user.

## Configuration

Example `channels.carbonvoice` account:

```json5
{
  channels: {
    carbonvoice: {
      accounts: {
        default: {
          enabled: true,
          baseUrl: "https://api.carbonvoice.app",
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

`openclaw message send` / agent tools should use the **channel (conversation) id** as the `to` value — the same `channel_guid` Carbon Voice sends in webhooks.

## Docs links

- [AI Agent Guide (Notion)](https://phononx.notion.site/AI-Agent-Guide-31ec208443e280a6bb2bcc89339832bc)
- [OpenAPI](https://api.carbonvoice.app/docs-json)

https://docs.openclaw.ai/channels/carbonvoice
