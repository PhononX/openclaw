# @openclaw/carbonvoice

OpenClaw channel plugin for **Carbon Voice**: webhook delivery and text replies (voice/TTS stays on the Carbon Voice side).

Docs: `https://docs.openclaw.ai/channels/carbonvoice`  
Plugin system: `https://docs.openclaw.ai/plugin`

## Bundled vs installable

Carbon Voice ships **bundled** with the main `openclaw` npm package. Enable it with:

```bash
openclaw plugins enable carbonvoice
```

To try a different copy from disk (for example a patched checkout), install from a path or tarball; that copy **shadows** the bundled plugin when it uses the same id. See <https://docs.openclaw.ai/plugin> (discovery and precedence).

## Install (local path)

From the OpenClaw repo root:

```bash
openclaw plugins install ./extensions/carbonvoice
```

Restart the Gateway after install.

### Dev link (no copy)

```bash
openclaw plugins install --link ./extensions/carbonvoice
```

### Tarball

```bash
cd extensions/carbonvoice
npm pack
# On the target host:
openclaw plugins install ./openclaw-carbonvoice-<version>.tgz
```

Peer dependency: `openclaw` must satisfy `peerDependencies.openclaw` in this package’s `package.json`.

## Dependencies

The plugin install runs `npm install --omit=dev` in the extension directory. Ensure `socket.io-client` resolves (declared in `dependencies`).

## Config

Channel config lives under `channels.carbonvoice` (multi-account under `accounts.<accountId>`).

Typical fields per account:

- `clientId` — OAuth2 app `client_id` (used in `/apps/{client_id}/subscribe`).
- `apiKey` — API key (`x-api-key` on Carbon Voice API).
- `creatorId` — Carbon Voice user id allowed to trigger inbound messages.
- `baseUrl` — API base (default `https://api.carbonvoice.app`).
- `publicWebhookBaseUrl` — public origin of your OpenClaw gateway (webhook delivery).
- `webhookPath` — path on the gateway for Carbon Voice webhooks (default `/openclaw/carbonvoice/webhook`).

Example:

```json5
{
  channels: {
    carbonvoice: {
      accounts: {
        default: {
          enabled: true,
          clientId: "YOUR_CLIENT_ID",
          apiKey: "YOUR_API_KEY",
          creatorId: "YOUR_USER_GUID",
          publicWebhookBaseUrl: "https://gateway.example.com",
        },
      },
    },
  },
}
```

Use `openclaw onboard` or channel setup for interactive configuration where available.
