# Install CarbonVoice Plugin From a `.tgz`

This guide is for operators who already have a packaged CarbonVoice plugin tarball, for example:

- `carbonvoice-openclaw-extension-2026.3.14.tgz` (filename npm uses for scoped package `@carbonvoice/openclaw-extension`)

The tarball **must** include compiled `dist/*.js` and the publish manifest overlay (`openclaw.runtimeExtensions` pointing at `./dist/index.js`). If `openclaw plugins install` says the package only ships `.ts` sources, rebuild the archive using the commands in `extensions/carbonvoice/README.md` (“Tarball (npm / ClawHub)”) from an OpenClaw source checkout.

No OpenClaw source checkout is required **on the install host** if you were given a correct `.tgz`.

## Prerequisites

- OpenClaw is already installed on the host.
- Your OpenClaw version satisfies the plugin peer dependency (`openclaw >= 2026.3.14`).
- You have a Carbon Voice agent PAT (`cv_pat_...`).
- Your OpenClaw gateway has a public URL that Carbon Voice can reach.

## 1) Install the plugin tarball

From the directory that contains the `.tgz` file:

```bash
openclaw plugins install ./carbonvoice-openclaw-extension-<version>.tgz
```

After the package is published to npm, you can install by spec instead:

```bash
openclaw plugins install npm:@carbonvoice/openclaw-extension
```

Use the exact tarball filename when installing from a file.

## 2) Enable the plugin

```bash
openclaw plugins enable carbonvoice
```

If your config uses a non-empty `plugins.allow`, add `carbonvoice` to that allowlist or the plugin will be blocked.

## 3) Configure CarbonVoice

CarbonVoice config lives under `channels.carbonvoice`.

At minimum, set:

- `apiKey` (or `AGENT_PAT` env var for the default account)
- `publicWebhookBaseUrl`

Optional but common:

- `webhookPath` (default: `/openclaw/carbonvoice/webhook`)
- `creatorId` (limit inbound messages to one Carbon Voice user id)
- `baseUrl` (default: `https://api.carbonvoice.app`)

Example `openclaw.json`:

```json
{
  "channels": {
    "carbonvoice": {
      "accounts": {
        "default": {
          "enabled": true,
          "apiKey": "cv_pat_...",
          "publicWebhookBaseUrl": "https://gateway.example.com",
          "webhookPath": "/openclaw/carbonvoice/webhook"
        }
      }
    }
  }
}
```

If you prefer environment credentials for the default account:

```bash
export AGENT_PAT="cv_pat_..."
```

Then keep `publicWebhookBaseUrl` in config.

## 4) Restart the gateway

```bash
openclaw gateway restart
```

## 5) Verify

Optional runtime verification:

```bash
openclaw plugins inspect carbonvoice --runtime --json
```

You should see the plugin present and loadable, then Carbon Voice messages should trigger replies after webhook setup succeeds.
