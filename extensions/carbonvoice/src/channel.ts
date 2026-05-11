import { randomUUID } from "node:crypto";
import type {
  ChannelGatewayContext,
  ChannelOutboundContext,
} from "openclaw/plugin-sdk/channel-contract";
import { resolveInboundRouteEnvelopeBuilderWithRuntime } from "openclaw/plugin-sdk/inbound-envelope";
import { registerPluginHttpRoute } from "openclaw/plugin-sdk/webhook-ingress";
import { getCarbonVoiceRuntime } from "../runtime.js";
import {
  carbonVoiceStartMessage,
  carbonVoiceSubscribeToMessages,
  carbonVoiceWhoAmI,
  resolveCarbonVoiceWhoAmIUserId,
} from "./api-client.js";
import {
  carbonVoiceConfigSchema,
  carbonVoiceMeta,
  carbonVoiceSetupWizard,
  deleteCarbonVoiceAccount,
  joinCarbonVoicePublicWebhookUrl,
  listCarbonVoiceAccountIds,
  resolveCarbonVoiceAccount,
  resolveDefaultCarbonVoiceAccountId,
  setCarbonVoiceAccountEnabled,
  CARBONVOICE_CHANNEL_ID,
} from "./shared.js";
import { buildCarbonVoiceSubscribePayload } from "./subscribe.js";
import { createCarbonVoiceWebhookHandler } from "./webhook-handler.js";
// import { startCarbonVoiceMessageStream } from "./stream-client.js";

const activeRouteUnregisters = new Map<string, () => void>();

function waitUntilAbort(signal?: AbortSignal, onAbort?: () => void): Promise<void> {
  return new Promise((resolve) => {
    const complete = () => {
      onAbort?.();
      resolve();
    };
    if (!signal) {
      return;
    }
    if (signal.aborted) {
      complete();
      return;
    }
    signal.addEventListener("abort", complete, { once: true });
  });
}

export const carbonVoicePlugin = {
  id: CARBONVOICE_CHANNEL_ID,
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
      clientId: account.clientId ?? "[missing]",
      allowedUserId: account.creatorId ?? "[missing]",
      baseUrl: account.baseUrl ?? "[missing]",
      publicWebhookBaseUrl: account.publicWebhookBaseUrl ?? "[missing]",
      webhookPath: account.webhookPath ?? "[missing]",
      credentialSource: account.apiKey ? "apiKey" : "missing",
    }),
  },
  outbound: {
    deliveryMode: "direct" as const,
    sendText: async ({ cfg, to, text, accountId, replyToId }: ChannelOutboundContext) => {
      const resolvedAccountId = accountId?.trim() || resolveDefaultCarbonVoiceAccountId(cfg);
      const account = resolveCarbonVoiceAccount({ cfg, accountId: resolvedAccountId });
      if (!account.clientId) {
        throw new Error("Carbon Voice: missing clientId");
      }
      if (!account.apiKey) {
        throw new Error(
          "Carbon Voice: missing apiKey (configure channels.carbonvoice or CARBONVOICE_API_KEY)",
        );
      }
      const payload = {
        unique_client_id: randomUUID(),
        transcript: text,
        is_text_message: true,
        is_streaming: false,
        channel_id: to.trim(),
        ...(replyToId ? { reply_to_message_id: String(replyToId) } : {}),
      };
      const result = await carbonVoiceStartMessage({
        apiKey: account.apiKey,
        baseUrl: account.baseUrl,
        payload,
      });
      const mid = result.message_id ?? (result as { id?: string }).id;
      if (!mid) {
        throw new Error("Carbon Voice: start response missing message_id");
      }
      return {
        channel: CARBONVOICE_CHANNEL_ID,
        messageId: mid,
        chatId: to.trim(),
      };
    },
  },
  gateway: {
    startAccount: async (
      ctx: ChannelGatewayContext<ReturnType<typeof resolveCarbonVoiceAccount>>,
    ) => {
      const { cfg, accountId, log, abortSignal } = ctx;
      const account = resolveCarbonVoiceAccount({ cfg, accountId });

      if (!account.enabled) {
        log?.info?.(`Carbon Voice account ${accountId} is disabled, skipping`);
        return waitUntilAbort(abortSignal);
      }
      if (!account.configured) {
        log?.warn?.(
          `Carbon Voice account ${accountId} not configured: ${account.unconfiguredReason ?? ""}`,
        );
        return waitUntilAbort(abortSignal);
      }
      if (
        !account.clientId ||
        !account.apiKey ||
        !account.baseUrl ||
        !account.publicWebhookBaseUrl ||
        !account.webhookPath
      ) {
        log?.warn?.(`Carbon Voice account ${accountId} missing required fields`);
        return waitUntilAbort(abortSignal);
      }

      const channelRuntime = ctx.channelRuntime;
      if (!channelRuntime) {
        log?.error?.("Carbon Voice: channelRuntime unavailable; cannot dispatch replies");
        return waitUntilAbort(abortSignal);
      }

      const who = await carbonVoiceWhoAmI({
        apiKey: account.apiKey,
        baseUrl: account.baseUrl,
      });
      const selfId = resolveCarbonVoiceWhoAmIUserId(who);
      if (!selfId) {
        log?.error?.("Carbon Voice: /whoami did not return a user id; cannot subscribe safely");
        return waitUntilAbort(abortSignal);
      }
      const webhookUrl = joinCarbonVoicePublicWebhookUrl(
        account.publicWebhookBaseUrl,
        account.webhookPath,
      );

      const subscribeBody = buildCarbonVoiceSubscribePayload({
        webhookUrl,
        selfUserId: selfId,
        restrictInboundToCreatorId: account.creatorId,
      });

      try {
        const subscribePath = `/apps/subscribe`;
        log?.info?.(
          `Carbon Voice: subscribe request account=${accountId} baseUrl=${account.baseUrl} path=${subscribePath} body=${JSON.stringify(subscribeBody)}`,
        );
        await carbonVoiceSubscribeToMessages({
          apiKey: account.apiKey,
          baseUrl: account.baseUrl,
          payload: subscribeBody,
        });
        log?.info?.(`Carbon Voice: subscribed webhook ${webhookUrl} (account ${accountId})`);
      } catch (err) {
        log?.error?.(`Carbon Voice: subscribe failed: ${String(err)}`);
        return waitUntilAbort(abortSignal);
      }

      // Websocket path kept for quick rollback while webhook path is primary.
      // const stream = startCarbonVoiceMessageStream({
      //   baseUrl: account.baseUrl,
      //   apiKey: account.apiKey,
      //   log,
      //   onMessageCreated: async (_messageId: string) => {},
      // });

      const recentIds = new Set<string>();
      const handler = createCarbonVoiceWebhookHandler({
        account,
        recentMessageIds: recentIds,
        log,
        deliver: async (msg) => {
          const currentCfg = await getCarbonVoiceRuntime().config.loadConfig();
          const { route, buildEnvelope } = resolveInboundRouteEnvelopeBuilderWithRuntime({
            cfg: currentCfg,
            channel: CARBONVOICE_CHANNEL_ID,
            accountId: account.accountId,
            peer: { kind: "direct", id: msg.channelGuid },
            runtime: channelRuntime as never,
            sessionStore: currentCfg.session?.store,
          });
          const { storePath, body } = buildEnvelope({
            channel: "Carbon Voice",
            from: msg.creatorGuid,
            timestamp: Date.now(),
            body: msg.body,
          });

          const msgCtx = channelRuntime.reply.finalizeInboundContext({
            Body: body,
            RawBody: msg.body,
            CommandBody: msg.body,
            From: `${CARBONVOICE_CHANNEL_ID}:${msg.creatorGuid}`,
            To: `${CARBONVOICE_CHANNEL_ID}:${msg.channelGuid}`,
            SessionKey: route.sessionKey,
            AccountId: account.accountId,
            OriginatingChannel: CARBONVOICE_CHANNEL_ID,
            OriginatingTo: `${CARBONVOICE_CHANNEL_ID}:${msg.channelGuid}`,
            ChatType: "direct",
            SenderName: msg.creatorGuid,
            SenderId: msg.creatorGuid,
            Provider: CARBONVOICE_CHANNEL_ID,
            Surface: CARBONVOICE_CHANNEL_ID,
            ConversationLabel: msg.channelGuid,
            MessageSid: msg.messageGuid,
            ReplyToId: msg.messageGuid,
            Timestamp: Date.now(),
            CommandAuthorized: true,
          });

          void channelRuntime.session
            .recordSessionMetaFromInbound({
              storePath,
              sessionKey: msgCtx.SessionKey ?? route.sessionKey,
              ctx: msgCtx,
            })
            .catch((err: unknown) => {
              log?.warn?.(`carbonvoice: session meta: ${String(err)}`);
            });

          await channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: msgCtx,
            cfg: currentCfg,
            dispatcherOptions: {
              deliver: async (payload: { text?: string; body?: string }) => {
                const outText = payload?.text ?? payload?.body;
                if (!outText?.trim()) {
                  return;
                }
                await carbonVoiceStartMessage({
                  apiKey: account.apiKey!,
                  baseUrl: account.baseUrl,
                  payload: {
                    unique_client_id: randomUUID(),
                    transcript: outText,
                    is_text_message: true,
                    is_streaming: false,
                    channel_id: msg.channelGuid,
                    reply_to_message_id: msg.replyToCarbonMessageId,
                  },
                });
              },
              onReplyStart: () => {
                log?.info?.(`Carbon Voice: agent reply started for ${msg.channelGuid}`);
              },
            },
          });
        },
      });

      const routeKey = `${accountId}:${account.webhookPath}`;
      const prev = activeRouteUnregisters.get(routeKey);
      if (prev) {
        log?.info?.(`Carbon Voice: replacing stale route ${account.webhookPath}`);
        prev();
        activeRouteUnregisters.delete(routeKey);
      }

      const unregister = registerPluginHttpRoute({
        path: account.webhookPath,
        auth: "plugin",
        replaceExisting: true,
        pluginId: CARBONVOICE_CHANNEL_ID,
        accountId: account.accountId,
        log: (m: string) => log?.info?.(m),
        handler,
      });
      activeRouteUnregisters.set(routeKey, unregister);
      log?.info?.(`Carbon Voice: registered HTTP route ${account.webhookPath}`);

      return waitUntilAbort(abortSignal, () => {
        log?.info?.(`Carbon Voice: stopping account ${accountId}`);
        unregister();
        activeRouteUnregisters.delete(routeKey);
        // stream.stop();
      });
    },
    stopAccount: async (
      ctx: ChannelGatewayContext<ReturnType<typeof resolveCarbonVoiceAccount>>,
    ) => {
      ctx.log?.info?.(`Carbon Voice account ${ctx.accountId} stopped`);
    },
  },
};
