import { randomUUID } from "node:crypto";
import { resolveInboundRouteEnvelopeBuilderWithRuntime } from "openclaw/plugin-sdk";
import type {
  ChannelGatewayContext,
  ChannelOutboundContext,
} from "../../../src/channels/plugins/types.adapters.js";
import { getCarbonVoiceRuntime } from "../runtime.js";
import {
  carbonVoiceGetMessageById,
  carbonVoiceStartMessage,
  carbonVoiceWhoAmI,
  resolveCarbonVoiceWhoAmIUserId,
} from "./api-client.js";
import {
  carbonVoiceConfigSchema,
  carbonVoiceMeta,
  carbonVoiceSetupWizard,
  deleteCarbonVoiceAccount,
  listCarbonVoiceAccountIds,
  resolveCarbonVoiceAccount,
  resolveDefaultCarbonVoiceAccountId,
  setCarbonVoiceAccountEnabled,
  CARBONVOICE_CHANNEL_ID,
} from "./shared.js";
import { startCarbonVoiceMessageStream } from "./stream-client.js";

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
      allowedUserId: account.creatorId ?? "[missing]",
      baseUrl: account.baseUrl ?? "[missing]",
      credentialSource: account.apiKey ? "apiKey" : "missing",
    }),
  },
  outbound: {
    deliveryMode: "direct" as const,
    sendText: async ({ cfg, to, text, accountId, replyToId }: ChannelOutboundContext) => {
      const resolvedAccountId = accountId?.trim() || resolveDefaultCarbonVoiceAccountId(cfg);
      const account = resolveCarbonVoiceAccount({ cfg, accountId: resolvedAccountId });
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
      if (!account.apiKey || !account.baseUrl) {
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
        log?.error?.("Carbon Voice: /whoami did not return a user id; cannot start websocket");
        return waitUntilAbort(abortSignal);
      }
      const recentIds = new Set<string>();
      const stream = startCarbonVoiceMessageStream({
        baseUrl: account.baseUrl,
        apiKey: account.apiKey,
        log,
        onMessageCreated: async (messageId: string) => {
          if (recentIds.has(messageId)) {
            return;
          }
          recentIds.add(messageId);
          if (recentIds.size > 10_000) {
            recentIds.clear();
          }

          let details;
          try {
            details = await carbonVoiceGetMessageById({
              apiKey: account.apiKey!,
              baseUrl: account.baseUrl,
              messageId,
            });
          } catch (err) {
            log?.warn?.(`Carbon Voice: message fetch failed for ${messageId}: ${String(err)}`);
            return;
          }

          const message = details?.message;
          const creatorGuid =
            typeof message?.creator_guid === "string" ? message.creator_guid.trim() : "";
          const channelGuid = Array.isArray(message?.channel_guids)
            ? message.channel_guids.find((v) => typeof v === "string" && v.trim())?.trim()
            : undefined;
          const body =
            (typeof message?.transcript_txt === "string" ? message.transcript_txt : undefined) ??
            (typeof message?.ai_summary_txt === "string" ? message.ai_summary_txt : undefined) ??
            "";
          if (!creatorGuid || !channelGuid || !body.trim()) {
            return;
          }
          if (creatorGuid === selfId) {
            return;
          }
          if (account.creatorId && creatorGuid !== account.creatorId) {
            return;
          }

          const messageGuid =
            (typeof message?.message_guid === "string" ? message.message_guid.trim() : "") ||
            messageId;
          const replyToCarbonMessageId =
            (typeof message?.parent_message_guid === "string"
              ? message.parent_message_guid.trim()
              : "") || messageGuid;

          const currentCfg = await getCarbonVoiceRuntime().config.loadConfig();
          const { route, buildEnvelope } = resolveInboundRouteEnvelopeBuilderWithRuntime({
            cfg: currentCfg,
            channel: CARBONVOICE_CHANNEL_ID,
            accountId: account.accountId,
            peer: { kind: "direct", id: channelGuid },
            runtime: channelRuntime as never,
            sessionStore: currentCfg.session?.store,
          });
          const { storePath, body: inboundBody } = buildEnvelope({
            channel: "Carbon Voice",
            from: creatorGuid,
            timestamp: Date.now(),
            body,
          });

          const msgCtx = channelRuntime.reply.finalizeInboundContext({
            Body: inboundBody,
            RawBody: body,
            CommandBody: body,
            From: `${CARBONVOICE_CHANNEL_ID}:${creatorGuid}`,
            To: `${CARBONVOICE_CHANNEL_ID}:${channelGuid}`,
            SessionKey: route.sessionKey,
            AccountId: account.accountId,
            OriginatingChannel: CARBONVOICE_CHANNEL_ID,
            OriginatingTo: `${CARBONVOICE_CHANNEL_ID}:${channelGuid}`,
            ChatType: "direct",
            SenderName: creatorGuid,
            SenderId: creatorGuid,
            Provider: CARBONVOICE_CHANNEL_ID,
            Surface: CARBONVOICE_CHANNEL_ID,
            ConversationLabel: channelGuid,
            MessageSid: messageGuid,
            ReplyToId: messageGuid,
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
                    channel_id: channelGuid,
                    reply_to_message_id: replyToCarbonMessageId,
                  },
                });
              },
              onReplyStart: () => {
                log?.info?.(`Carbon Voice: agent reply started for ${channelGuid}`);
              },
            },
          });
        },
      });
      log?.info?.(`Carbon Voice: websocket listener started (account ${accountId})`);

      return waitUntilAbort(abortSignal, () => {
        log?.info?.(`Carbon Voice: stopping account ${accountId}`);
        stream.stop();
      });
    },
    stopAccount: async (
      ctx: ChannelGatewayContext<ReturnType<typeof resolveCarbonVoiceAccount>>,
    ) => {
      ctx.log?.info?.(`Carbon Voice account ${ctx.accountId} stopped`);
    },
  },
};
