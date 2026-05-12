# @openclaw/carbonvoice

OpenClaw channel plugin for **Carbon Voice**: PAT websocket plus optional webhooks, with `POST /v3/messages/recent` catch-up after disconnects; text replies (voice/TTS stays on the Carbon Voice side).

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

### Tarball (npm / ClawHub)

Published plugins must ship **compiled** `dist/*.js` files. Plain `npm pack` inside `extensions/carbonvoice` only packs TypeScript sources and **`openclaw plugins install` will reject the tarball**.

From the **OpenClaw repository root** (after `pnpm install`):

```bash
node scripts/lib/plugin-npm-runtime-build.mjs extensions/carbonvoice
# --pack-destination must already exist (npm does not mkdir for you)
mkdir -p ./dist-pack
node scripts/lib/plugin-npm-package-manifest.mjs --run extensions/carbonvoice -- npm pack --pack-destination ./dist-pack
```

Example using `/tmp` only:

```bash
node scripts/lib/plugin-npm-package-manifest.mjs --run extensions/carbonvoice -- npm pack --pack-destination /tmp
```

That writes `openclaw-carbonvoice-<version>.tgz` with `dist/`, `openclaw.runtimeExtensions`, and `openclaw.runtimeSetupEntry` set for the installer.

On the target host:

```bash
openclaw plugins install ./openclaw-carbonvoice-<version>.tgz
# or
openclaw plugins install npm-pack:/tmp/openclaw-carbonvoice-<version>.tgz
```

Publish to npm or ClawHub using the same build step, then run the repo’s plugin release checks (`pnpm release:plugins:npm:check`, `pnpm release:plugins:npm:plan`) and your ClawHub publish flow, consistent with other `publishToNpm` extensions.

Peer dependency: `openclaw` must satisfy `peerDependencies.openclaw` in this package’s `package.json`.

## Dependencies

The plugin install runs `npm install --omit=dev` in the extension directory. Ensure `socket.io-client` resolves (declared in `dependencies`).

## Config

Channel config lives under `channels.carbonvoice` (multi-account under `accounts.<accountId>`).

**Credential:** set the **`AGENT_PAT`** environment variable to your Carbon Voice agent personal access token (`cv_pat_...`) for the default account, or set `apiKey` on the account in config (same value). On startup, OpenClaw calls `GET /whoami`, opens the realtime websocket, and runs recents catch-up on connect. If you set **`publicWebhookBaseUrl`**, it also subscribes webhooks and registers the HTTP route. Inbound filters exclude the PAT user’s own messages; optional **`creatorId`** limits inbound to that user only.

Typical fields per account:

- `creatorId` (optional) — Carbon Voice user id; when set, only messages from this user are delivered (in addition to excluding the PAT user).
- `baseUrl` — API base (default `https://api.carbonvoice.app`).
- `publicWebhookBaseUrl` (optional) — public origin of your OpenClaw gateway for Carbon Voice webhooks. Omit for PAT-only websocket mode.
- `webhookPath` — path on the gateway when using webhooks (default `/openclaw/carbonvoice/webhook` when `publicWebhookBaseUrl` is set).

Example (PAT-only via env):

```bash
export AGENT_PAT="cv_pat_..."
```

```json5
{
  channels: {
    carbonvoice: {
      accounts: {
        default: {
          enabled: true,
          // optional: "publicWebhookBaseUrl": "https://gateway.example.com",
          // optional: "creatorId": "YOUR_USER_GUID",
        },
      },
    },
  },
}
```

Use `openclaw onboard` or channel setup for interactive configuration where available.
