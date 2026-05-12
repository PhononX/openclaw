import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";

export const CARBONVOICE_CHANNEL_ID = "carbonvoice";
export const CARBONVOICE_DEFAULT_ACCOUNT_ID = "default";
export const CARBONVOICE_DEFAULT_BASE_URL = "https://api.carbonvoice.app";
export const CARBONVOICE_DEFAULT_WEBHOOK_PATH = "/openclaw/carbonvoice/webhook";

export function normalizeCarbonVoiceTarget(target: string): string | undefined {
  const trimmed = target.trim();
  if (!trimmed) {
    return undefined;
  }
  const withoutProvider = trimmed.replace(/^carbonvoice:/i, "");
  const withoutKind = withoutProvider.replace(/^(channel|conversation|direct):/i, "");
  return withoutKind.trim() || undefined;
}

export const carbonVoiceMeta = {
  id: CARBONVOICE_CHANNEL_ID,
  label: "Carbon Voice",
  selectionLabel: "Carbon Voice",
  docsPath: "/channels/carbonvoice",
  docsLabel: "carbonvoice",
  blurb:
    "Carbon Voice PAT websocket and optional webhooks; text replies (voice/TTS on the Carbon Voice side).",
  detailLabel: "Carbon Voice",
  order: 72,
} as const;

export type CarbonVoiceAccountConfig = {
  enabled?: boolean;
  name?: string;
  /** Carbon Voice API key or PAT (`cv_pat_...`); PATs use Bearer auth. */
  apiKey?: string;
  apiKeyFile?: string;
  /** Optional: only this Carbon Voice user id may trigger inbound (subscription adds creator_id eq). */
  creatorId?: string;
  baseUrl?: string;
  /** Public origin for your OpenClaw gateway (for webhook delivery). */
  publicWebhookBaseUrl?: string;
  /** Path on your OpenClaw gateway to receive Carbon Voice webhooks. */
  webhookPath?: string;
};

export type CarbonVoiceResolvedAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  unconfiguredReason?: string;
  name?: string;
  apiKey?: string;
  creatorId?: string;
  baseUrl?: string;
  publicWebhookBaseUrl?: string;
  webhookPath?: string;
  config: CarbonVoiceAccountConfig;
};

type CarbonVoiceChannelConfig = {
  enabled?: boolean;
  accounts?: Record<string, CarbonVoiceAccountConfig>;
  apiKey?: string;
  apiKeyFile?: string;
  creatorId?: string;
  baseUrl?: string;
  publicWebhookBaseUrl?: string;
  webhookPath?: string;
  name?: string;
};

function getChannelConfig(cfg: OpenClawConfig): CarbonVoiceChannelConfig {
  return (
    ((cfg.channels as Record<string, unknown> | undefined)?.[CARBONVOICE_CHANNEL_ID] as
      | CarbonVoiceChannelConfig
      | undefined) ?? {}
  );
}

function getAccounts(cfg: OpenClawConfig): Record<string, CarbonVoiceAccountConfig> {
  return getChannelConfig(cfg).accounts ?? {};
}

function getLegacyDefaultAccount(cfg: OpenClawConfig): CarbonVoiceAccountConfig {
  const channel = getChannelConfig(cfg);
  return {
    enabled: channel.enabled,
    name: channel.name,
    apiKey: channel.apiKey,
    apiKeyFile: channel.apiKeyFile,
    creatorId: channel.creatorId,
    baseUrl: channel.baseUrl,
    publicWebhookBaseUrl: channel.publicWebhookBaseUrl,
    webhookPath: channel.webhookPath,
  };
}

export function joinCarbonVoicePublicWebhookUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const p = path.trim().startsWith("/") ? path.trim() : `/${path.trim()}`;
  return `${base}${p}`;
}

function computeConfigured(
  resolved: Omit<CarbonVoiceResolvedAccount, "configured" | "unconfiguredReason" | "config">,
): { configured: boolean; unconfiguredReason?: string } {
  const reasons: string[] = [];
  if (!resolved.apiKey) {
    reasons.push("missing apiKey (or AGENT_PAT for default account)");
  }
  if (reasons.length > 0) {
    return { configured: false, unconfiguredReason: reasons.join("; ") };
  }
  return { configured: true };
}

export function listCarbonVoiceAccountIds(cfg: OpenClawConfig): string[] {
  const accountIds = Object.keys(getAccounts(cfg));
  if (accountIds.length > 0) {
    return accountIds;
  }
  const legacy = getLegacyDefaultAccount(cfg);
  if (
    legacy.apiKey ||
    legacy.apiKeyFile ||
    legacy.creatorId ||
    legacy.baseUrl ||
    legacy.publicWebhookBaseUrl ||
    legacy.webhookPath ||
    legacy.name ||
    legacy.enabled !== undefined
  ) {
    return [CARBONVOICE_DEFAULT_ACCOUNT_ID];
  }
  return [];
}

export function resolveDefaultCarbonVoiceAccountId(_cfg: OpenClawConfig): string {
  return CARBONVOICE_DEFAULT_ACCOUNT_ID;
}

export function resolveCarbonVoiceAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): CarbonVoiceResolvedAccount {
  const accountId = params.accountId?.trim() || CARBONVOICE_DEFAULT_ACCOUNT_ID;
  const accounts = getAccounts(params.cfg);
  const config =
    accounts[accountId] ??
    (accountId === CARBONVOICE_DEFAULT_ACCOUNT_ID ? getLegacyDefaultAccount(params.cfg) : {});

  const apiKey =
    config.apiKey?.trim() ||
    (accountId === CARBONVOICE_DEFAULT_ACCOUNT_ID ? process.env.AGENT_PAT?.trim() : undefined) ||
    undefined;
  const creatorId = config.creatorId?.trim() || undefined;
  const baseUrl = config.baseUrl?.trim() || CARBONVOICE_DEFAULT_BASE_URL;
  const publicWebhookBaseUrl = config.publicWebhookBaseUrl?.trim() || undefined;
  const webhookPath =
    config.webhookPath?.trim() ||
    (publicWebhookBaseUrl ? CARBONVOICE_DEFAULT_WEBHOOK_PATH : undefined);

  const baseResolved = {
    accountId,
    enabled: config.enabled !== false,
    name: config.name?.trim() || undefined,
    apiKey,
    creatorId,
    baseUrl,
    publicWebhookBaseUrl,
    webhookPath,
    config,
  };
  const { configured, unconfiguredReason } = computeConfigured(baseResolved);
  return {
    ...baseResolved,
    configured,
    unconfiguredReason,
  };
}

export function setCarbonVoiceAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
  patch: CarbonVoiceAccountConfig,
): OpenClawConfig {
  const normalizedAccountId = accountId.trim() || CARBONVOICE_DEFAULT_ACCOUNT_ID;
  const channel = getChannelConfig(cfg);
  const accounts = { ...getAccounts(cfg) };
  const existing =
    accounts[normalizedAccountId] ??
    (normalizedAccountId === CARBONVOICE_DEFAULT_ACCOUNT_ID ? getLegacyDefaultAccount(cfg) : {});
  accounts[normalizedAccountId] = {
    ...existing,
    ...patch,
  };
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [CARBONVOICE_CHANNEL_ID]: {
        ...channel,
        accounts,
      },
    },
  };
}

export function setCarbonVoiceAccountEnabled(params: {
  cfg: OpenClawConfig;
  accountId: string;
  enabled: boolean;
}): OpenClawConfig {
  return setCarbonVoiceAccountConfig(params.cfg, params.accountId, { enabled: params.enabled });
}

export function deleteCarbonVoiceAccount(params: {
  cfg: OpenClawConfig;
  accountId: string;
}): OpenClawConfig {
  const normalizedAccountId = params.accountId.trim() || CARBONVOICE_DEFAULT_ACCOUNT_ID;
  const channel = getChannelConfig(params.cfg);
  const accounts = { ...getAccounts(params.cfg) };
  delete accounts[normalizedAccountId];
  return {
    ...params.cfg,
    channels: {
      ...params.cfg.channels,
      [CARBONVOICE_CHANNEL_ID]: {
        ...channel,
        ...(Object.keys(accounts).length > 0 ? { accounts } : {}),
      },
    },
  };
}

const accountProps = {
  enabled: { type: "boolean" },
  name: { type: "string" },
  apiKey: { type: "string" },
  apiKeyFile: { type: "string" },
  creatorId: { type: "string" },
  baseUrl: { type: "string" },
  publicWebhookBaseUrl: { type: "string" },
  webhookPath: { type: "string" },
} as const;

export const carbonVoiceConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" },
    name: { type: "string" },
    apiKey: { type: "string" },
    apiKeyFile: { type: "string" },
    creatorId: { type: "string" },
    baseUrl: { type: "string" },
    publicWebhookBaseUrl: { type: "string" },
    webhookPath: { type: "string" },
    accounts: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        properties: { ...accountProps },
      },
    },
  },
} as const;

export const carbonVoiceSetupWizard = {
  channel: CARBONVOICE_CHANNEL_ID,
  status: {
    configuredLabel: "configured",
    unconfiguredLabel: "needs setup",
    resolveConfigured: ({ cfg }: { cfg: OpenClawConfig }) =>
      resolveCarbonVoiceAccount({ cfg, accountId: CARBONVOICE_DEFAULT_ACCOUNT_ID }).configured,
    resolveStatusLines: ({ cfg, configured }: { cfg: OpenClawConfig; configured: boolean }) => {
      const account = resolveCarbonVoiceAccount({ cfg, accountId: CARBONVOICE_DEFAULT_ACCOUNT_ID });
      return [
        configured
          ? "Carbon Voice: configured"
          : `Carbon Voice: not configured${account.unconfiguredReason ? ` (${account.unconfiguredReason})` : ""}`,
      ];
    },
    resolveSelectionHint: ({ configured }: { configured: boolean }) =>
      configured ? "configured" : "voice channel · needs setup",
  },
  introNote: {
    title: "Carbon Voice setup",
    lines: [
      "Connect Carbon Voice with OpenClaw using a Carbon Voice agent PAT (AGENT_PAT or channels.carbonvoice apiKey).",
      "PAT-only: OpenClaw uses a realtime websocket plus POST /v3/messages/recent catch-up after disconnects.",
      "Optional: set publicWebhookBaseUrl to also subscribe message.posted.to.channel webhooks on your gateway.",
      `API base URL defaults to ${CARBONVOICE_DEFAULT_BASE_URL}.`,
      "Docs: /channels/carbonvoice",
    ] as string[],
  },
  credentials: [
    {
      inputKey: "apiKey",
      providerHint: CARBONVOICE_CHANNEL_ID,
      credentialLabel: "Agent PAT",
      preferredEnvVar: "AGENT_PAT",
      envPrompt: "AGENT_PAT detected. Use env var?",
      keepPrompt: "Carbon Voice PAT already configured. Keep it?",
      inputPrompt: "Enter Carbon Voice agent PAT",
      allowEnv: ({ accountId }: { accountId: string }) =>
        accountId === CARBONVOICE_DEFAULT_ACCOUNT_ID,
      inspect: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) => {
        const account = resolveCarbonVoiceAccount({ cfg, accountId });
        return {
          accountConfigured: account.configured,
          hasConfiguredValue: Boolean(account.config?.apiKey?.trim()),
          resolvedValue: account.config?.apiKey,
          envValue:
            accountId === CARBONVOICE_DEFAULT_ACCOUNT_ID
              ? process.env.AGENT_PAT?.trim() || undefined
              : undefined,
        };
      },
      applyUseEnv: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) =>
        setCarbonVoiceAccountConfig(cfg, accountId, {
          apiKey: undefined,
          apiKeyFile: undefined,
        }),
      applySet: ({
        cfg,
        accountId,
        value,
      }: {
        cfg: OpenClawConfig;
        accountId: string;
        value: unknown;
      }) =>
        setCarbonVoiceAccountConfig(cfg, accountId, {
          apiKey: typeof value === "string" ? value : String(value ?? ""),
          apiKeyFile: undefined,
        }),
    },
  ],
  textInputs: [
    {
      inputKey: "creatorIdFilter",
      message:
        "Optional: restrict inbound to one Carbon Voice user id (leave empty to allow any non-bot sender)",
      placeholder: "user_guid",
      required: false,
      applyEmptyValue: true,
      currentValue: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) =>
        resolveCarbonVoiceAccount({ cfg, accountId }).creatorId,
      keepPrompt: (value: string) => `Allowed user id is ${value}. Keep it?`,
      normalizeValue: ({ value }: { value: string }) => value.trim(),
      validate: () => undefined,
      applySet: ({
        cfg,
        accountId,
        value,
      }: {
        cfg: OpenClawConfig;
        accountId: string;
        value: string;
      }) =>
        setCarbonVoiceAccountConfig(cfg, accountId, {
          creatorId: value.trim() ? value.trim() : undefined,
        }),
    },
    {
      inputKey: "publicWebhookBaseUrl",
      message:
        "Optional: public webhook base URL for Carbon Voice to POST events (e.g. https://gateway.example.com). Leave empty for PAT-only websocket mode.",
      placeholder: "https://…",
      required: false,
      currentValue: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) =>
        resolveCarbonVoiceAccount({ cfg, accountId }).publicWebhookBaseUrl,
      keepPrompt: (value: string) => `Public webhook URL is ${value}. Keep it?`,
      validate: ({ value }: { value: string }) => {
        const v = value.trim();
        if (!v) {
          return undefined;
        }
        try {
          const url = new URL(v);
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            return "URL must start with http:// or https://";
          }
          return undefined;
        } catch {
          return "Enter a valid URL";
        }
      },
      normalizeValue: ({ value }: { value: string }) => value.trim().replace(/\/$/, ""),
      applyEmptyValue: true,
      applySet: ({
        cfg,
        accountId,
        value,
      }: {
        cfg: OpenClawConfig;
        accountId: string;
        value: string;
      }) =>
        setCarbonVoiceAccountConfig(cfg, accountId, {
          publicWebhookBaseUrl: value.trim() ? value : undefined,
        }),
    },
    {
      inputKey: "webhookPath",
      message: `Webhook path on OpenClaw (default: ${CARBONVOICE_DEFAULT_WEBHOOK_PATH})`,
      placeholder: CARBONVOICE_DEFAULT_WEBHOOK_PATH,
      required: false,
      currentValue: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) =>
        resolveCarbonVoiceAccount({ cfg, accountId }).webhookPath,
      keepPrompt: (value: string) => `Webhook path is ${value}. Keep it?`,
      normalizeValue: ({ value }: { value: string }) =>
        (value.trim() || CARBONVOICE_DEFAULT_WEBHOOK_PATH).trim(),
      validate: ({ value }: { value: string }) => {
        const p = (value.trim() || CARBONVOICE_DEFAULT_WEBHOOK_PATH).trim();
        return p.startsWith("/") ? undefined : "Path must start with /";
      },
      applyEmptyValue: true,
      applySet: ({
        cfg,
        accountId,
        value,
      }: {
        cfg: OpenClawConfig;
        accountId: string;
        value: string;
      }) =>
        setCarbonVoiceAccountConfig(cfg, accountId, {
          webhookPath: value.trim() || CARBONVOICE_DEFAULT_WEBHOOK_PATH,
        }),
    },
    {
      inputKey: "url",
      message: "Optional: Carbon Voice API base URL",
      placeholder: "https://…",
      required: false,
      currentValue: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) =>
        resolveCarbonVoiceAccount({ cfg, accountId }).baseUrl,
      keepPrompt: (value: string) => `Carbon Voice base URL is ${value}. Keep it?`,
      validate: ({ value }: { value: string }) => {
        try {
          const url = new URL(value);
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            return "Base URL must start with http:// or https://";
          }
          return undefined;
        } catch {
          return "Enter a valid URL";
        }
      },
      normalizeValue: ({ value }: { value: string }) => value.trim().replace(/\/$/, ""),
      applyEmptyValue: true,
      applySet: ({
        cfg,
        accountId,
        value,
      }: {
        cfg: OpenClawConfig;
        accountId: string;
        value: string;
      }) =>
        setCarbonVoiceAccountConfig(cfg, accountId, {
          baseUrl: value.trim() || undefined,
        }),
    },
  ],
  finalize: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) => ({
    cfg: setCarbonVoiceAccountEnabled({ cfg, accountId, enabled: true }),
  }),
} as const;
