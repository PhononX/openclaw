import {
  carbonVoiceConfigSchema,
  carbonVoiceMeta,
  carbonVoiceSetupWizard,
  deleteCarbonVoiceAccount,
  listCarbonVoiceAccountIds,
  resolveCarbonVoiceAccount,
  resolveDefaultCarbonVoiceAccountId,
  setCarbonVoiceAccountEnabled,
} from "./shared.js";

export const carbonVoiceSetupPlugin = {
  id: "carbonvoice",
  meta: carbonVoiceMeta,
  setupWizard: carbonVoiceSetupWizard,
  capabilities: {
    chatTypes: ["direct"],
    media: true,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.carbonvoice"] },
  configSchema: carbonVoiceConfigSchema,
  config: {
    listAccountIds: listCarbonVoiceAccountIds,
    resolveAccount: (
      cfg: Parameters<typeof resolveCarbonVoiceAccount>[0]["cfg"],
      accountId?: string | null,
    ) => resolveCarbonVoiceAccount({ cfg, accountId }),
    defaultAccountId: resolveDefaultCarbonVoiceAccountId,
    setAccountEnabled: setCarbonVoiceAccountEnabled,
    deleteAccount: deleteCarbonVoiceAccount,
    isConfigured: (account: ReturnType<typeof resolveCarbonVoiceAccount>) => account.configured,
    unconfiguredReason: (account: ReturnType<typeof resolveCarbonVoiceAccount>) =>
      account.configured ? undefined : (account.unconfiguredReason ?? "not configured"),
    describeAccount: (account: ReturnType<typeof resolveCarbonVoiceAccount>) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      allowedUserId: account.creatorId ?? "(any)",
      baseUrl: account.baseUrl ?? "[missing]",
      credentialSource: account.apiKey ? "apiKey" : "missing",
    }),
  },
  description: "Configure the Carbon Voice channel",
};
