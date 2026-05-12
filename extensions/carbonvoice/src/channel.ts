import { randomUUID } from "node:crypto";
import type {
  ChannelGatewayContext,
  ChannelOutboundContext,
} from "openclaw/plugin-sdk/channel-contract";
import { resolveInboundRouteEnvelopeBuilderWithRuntime } from "openclaw/plugin-sdk/inbound-envelope";
import { registerPluginHttpRoute } from "openclaw/plugin-sdk/webhook-ingress";
import { getCarbonVoiceRuntime } from "../runtime.js";
import {
  carbonVoiceAddAcknowledgedReaction,
  carbonVoiceDeliverArgsFromMessageDetailsResponse,
  carbonVoiceExtractTextFromMessageV2Row,
  carbonVoiceGetMessageById,
  carbonVoiceGetRecentMessages,
  carbonVoiceInboundCreatorMatchesSubscriptionFilter,
  carbonVoiceStartMessage,
  carbonVoiceSubscribeToMessages,
  carbonVoiceWhoAmI,
  isCarbonVoiceDuplicateWebhookSubscribeError,
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
  normalizeCarbonVoiceTarget,
} from "./shared.js";
import { startCarbonVoiceMessageStream } from "./stream-client.js";
import { buildCarbonVoiceSubscribePayload } from "./subscribe.js";
import type { CarbonVoiceWebhookDeliverArgs } from "./webhook-handler.js";
import { createCarbonVoiceWebhookHandler } from "./webhook-handler.js";

const activeRouteUnregisters = new Map<string, () => void>();

const CARBONVOICE_RECENTS_BOOTSTRAP_MS = 3 * 60 * 1000;
const CARBONVOICE_RECENTS_LIMIT = 100;
const CARBONVOICE_DEDUPE_MAX = 10_000;

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
  messaging: {
    targetPrefixes: [CARBONVOICE_CHANNEL_ID, "cv"],
    normalizeTarget: normalizeCarbonVoiceTarget,
    parseExplicitTarget: ({ raw }: { raw: string }) => {
      const to = normalizeCarbonVoiceTarget(raw);
      return to ? { to, chatType: "direct" as const } : null;
    },
    inferTargetChatType: () => "direct" as const,
    targetResolver: {
      looksLikeId: (_raw: string, normalized?: string) => Boolean(normalized?.trim()),
      hint: "<channel_guid|carbonvoice:channel_guid>",
    },
  },
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
      publicWebhookBaseUrl: account.publicWebhookBaseUrl ?? "(PAT-only / websocket)",
      webhookPath: account.webhookPath ?? "(none)",
      credentialSource: account.apiKey ? "apiKey" : "missing",
    }),
  },
  outbound: {
    deliveryMode: "direct" as const,
    resolveTarget: ({ to }) => {
      const normalized = to ? normalizeCarbonVoiceTarget(to) : undefined;
      return normalized
        ? { ok: true as const, to: normalized }
        : { ok: false as const, error: new Error("Carbon Voice target channel_guid is required") };
    },
    sendText: async ({ cfg, to, text, accountId, replyToId }: ChannelOutboundContext) => {
      const resolvedAccountId = accountId?.trim() || resolveDefaultCarbonVoiceAccountId(cfg);
      const account = resolveCarbonVoiceAccount({ cfg, accountId: resolvedAccountId });
      if (!account.apiKey) {
        throw new Error(
          "Carbon Voice: missing credential (configure channels.carbonvoice.apiKey or AGENT_PAT)",
        );
      }
      const payload = {
        unique_client_id: randomUUID(),
        transcript: text,
        is_text_message: true,
        is_streaming: false,
        channel_id: normalizeCarbonVoiceTarget(to) ?? to.trim(),
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

      const useWebhook = Boolean(account.publicWebhookBaseUrl?.trim());
      if (useWebhook && !account.webhookPath?.trim()) {
        log?.warn?.(
          `Carbon Voice account ${accountId}: publicWebhookBaseUrl set but webhookPath missing`,
        );
        return waitUntilAbort(abortSignal);
      }

      const channelRuntime = ctx.channelRuntime;
      if (!channelRuntime) {
        log?.error?.("Carbon Voice: channelRuntime unavailable; cannot dispatch replies");
        return waitUntilAbort(abortSignal);
      }

      const apiClientOpts = {
        apiKey: account.apiKey,
        baseUrl: account.baseUrl,
        requestLog: (m: string) => {
          log?.info?.(m);
        },
      };

      const who = await carbonVoiceWhoAmI(apiClientOpts);
      const selfId = resolveCarbonVoiceWhoAmIUserId(who);
      if (!selfId) {
        log?.error?.("Carbon Voice: /whoami did not return a user id; cannot subscribe safely");
        return waitUntilAbort(abortSignal);
      }

      const recentIds = new Set<string>();

      const deliverInbound = async (msg: CarbonVoiceWebhookDeliverArgs) => {
        const currentCfg = getCarbonVoiceRuntime().config.current();
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
                log?.info?.(
                  `Carbon Voice: agent deliver skipped POST /v3/messages/start (empty text/body) channel=${msg.channelGuid} reply_to=${msg.replyToCarbonMessageId}`,
                );
                return;
              }
              await carbonVoiceStartMessage({
                ...apiClientOpts,
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
      };

      let unregisterRoute: (() => void) | undefined;
      const routeKey = `${accountId}:${account.webhookPath ?? "none"}`;

      if (useWebhook && account.publicWebhookBaseUrl && account.webhookPath) {
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
            `Carbon Voice: subscribe account=${accountId} baseUrl=${account.baseUrl} path=${subscribePath}`,
          );
          await carbonVoiceSubscribeToMessages({
            ...apiClientOpts,
            payload: subscribeBody,
          });
          log?.info?.(`Carbon Voice: subscribed webhook ${webhookUrl} (account ${accountId})`);
        } catch (err) {
          if (isCarbonVoiceDuplicateWebhookSubscribeError(err)) {
            log?.info?.(
              `Carbon Voice: subscribe returned duplicate webhook URL (400); continuing with existing subscription (${webhookUrl}, account ${accountId})`,
            );
          } else {
            log?.error?.(`Carbon Voice: subscribe failed: ${String(err)}`);
            return waitUntilAbort(abortSignal);
          }
        }

        const prev = activeRouteUnregisters.get(routeKey);
        if (prev) {
          log?.info?.(`Carbon Voice: replacing stale route ${account.webhookPath}`);
          prev();
          activeRouteUnregisters.delete(routeKey);
        }

        const handler = createCarbonVoiceWebhookHandler({
          account,
          recentMessageIds: recentIds,
          log,
          deliver: deliverInbound,
        });

        unregisterRoute = registerPluginHttpRoute({
          path: account.webhookPath,
          auth: "plugin",
          replaceExisting: true,
          pluginId: CARBONVOICE_CHANNEL_ID,
          accountId: account.accountId,
          log: (m: string) => log?.info?.(m),
          handler,
        });
        activeRouteUnregisters.set(routeKey, unregisterRoute);
        log?.info?.(`Carbon Voice: registered HTTP route ${account.webhookPath}`);
      } else {
        log?.info?.(
          `Carbon Voice account ${accountId}: PAT-only mode (websocket + recents catch-up; no webhook subscribe)`,
        );
      }

      function parseCarbonVoiceTime(value: unknown): number {
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
          return value.getTime();
        }
        if (typeof value === "number" && Number.isFinite(value)) {
          return value;
        }
        if (typeof value === "string") {
          const t = Date.parse(value);
          return Number.isFinite(t) ? t : 0;
        }
        return 0;
      }

      async function runRecentsCatchUp(cursor: Date): Promise<void> {
        const rows = await carbonVoiceGetRecentMessages({
          ...apiClientOpts,
          body: {
            date: cursor.toISOString(),
            direction: "newer",
            use_last_updated: false,
            limit: CARBONVOICE_RECENTS_LIMIT,
          },
        });
        const sorted = [...rows].sort(
          (a, b) => parseCarbonVoiceTime(a.created_at) - parseCarbonVoiceTime(b.created_at),
        );
        for (const row of sorted) {
          const o = row as Record<string, unknown>;
          const messageGuid =
            typeof o.message_id === "string" && o.message_id.trim() ? o.message_id.trim() : "";
          if (!messageGuid || recentIds.has(messageGuid)) {
            continue;
          }
          const creatorId =
            typeof o.creator_id === "string" && o.creator_id.trim() ? o.creator_id.trim() : "";
          if (
            !creatorId ||
            !carbonVoiceInboundCreatorMatchesSubscriptionFilter({
              selfUserId: selfId,
              creatorId,
              restrictInboundToCreatorId: account.creatorId,
            })
          ) {
            continue;
          }
          const channelIds = Array.isArray(o.channel_ids) ? o.channel_ids : [];
          const channelGuid =
            typeof channelIds[0] === "string" && channelIds[0].trim() ? channelIds[0].trim() : "";
          if (!channelGuid) {
            continue;
          }
          let body = carbonVoiceExtractTextFromMessageV2Row(row) ?? "";
          let deliverArgs: CarbonVoiceWebhookDeliverArgs | undefined;
          let inboundFromMessageDetailsFetch = false;
          if (body) {
            const parentRaw = o.parent_message_id;
            const parent =
              typeof parentRaw === "string" && parentRaw.trim() ? parentRaw.trim() : undefined;
            const replyToCarbonMessageId = parent ?? messageGuid;
            deliverArgs = {
              body,
              channelGuid,
              messageGuid,
              creatorGuid: creatorId,
              replyToCarbonMessageId,
            };
          } else {
            const details = await carbonVoiceGetMessageById({
              ...apiClientOpts,
              messageId: messageGuid,
            });
            deliverArgs = carbonVoiceDeliverArgsFromMessageDetailsResponse(details);
            if (
              !deliverArgs ||
              !carbonVoiceInboundCreatorMatchesSubscriptionFilter({
                selfUserId: selfId,
                creatorId: deliverArgs.creatorGuid,
                restrictInboundToCreatorId: account.creatorId,
              })
            ) {
              continue;
            }
            inboundFromMessageDetailsFetch = true;
          }
          recentIds.add(messageGuid);
          if (recentIds.size > CARBONVOICE_DEDUPE_MAX) {
            recentIds.clear();
          }
          if (inboundFromMessageDetailsFetch) {
            try {
              await carbonVoiceAddAcknowledgedReaction({
                ...apiClientOpts,
                messageId: messageGuid,
              });
            } catch (err: unknown) {
              log?.warn?.(`Carbon Voice: acknowledged reaction failed: ${String(err)}`);
            }
          }
          await deliverInbound(deliverArgs);
        }
      }

      async function ingestByMessageId(messageId: string): Promise<void> {
        const trimmed = messageId.trim();
        if (!trimmed || recentIds.has(trimmed)) {
          return;
        }
        const details = await carbonVoiceGetMessageById({
          ...apiClientOpts,
          messageId: trimmed,
        });
        const args = carbonVoiceDeliverArgsFromMessageDetailsResponse(details);
        if (!args) {
          return;
        }
        if (
          !carbonVoiceInboundCreatorMatchesSubscriptionFilter({
            selfUserId: selfId,
            creatorId: args.creatorGuid,
            restrictInboundToCreatorId: account.creatorId,
          })
        ) {
          return;
        }
        if (recentIds.has(args.messageGuid)) {
          return;
        }
        recentIds.add(args.messageGuid);
        if (recentIds.size > CARBONVOICE_DEDUPE_MAX) {
          recentIds.clear();
        }
        try {
          await carbonVoiceAddAcknowledgedReaction({
            ...apiClientOpts,
            messageId: args.messageGuid,
          });
        } catch (err: unknown) {
          log?.warn?.(`Carbon Voice: acknowledged reaction failed: ${String(err)}`);
        }
        await deliverInbound(args);
      }

      let disconnectAt: Date | undefined;

      const stream = startCarbonVoiceMessageStream({
        baseUrl: account.baseUrl,
        apiKey: account.apiKey,
        log,
        onConnected: async () => {
          log?.info?.("Carbon Voice: websocket connected; running recents catch-up");
          const cursor = disconnectAt ?? new Date(Date.now() - CARBONVOICE_RECENTS_BOOTSTRAP_MS);
          try {
            await runRecentsCatchUp(cursor);
            disconnectAt = undefined;
          } catch {
            // Keep disconnectAt so a later reconnect can retry the same window.
          }
        },
        onDisconnected: async ({ reason }) => {
          disconnectAt = new Date();
          log?.info?.(
            `Carbon Voice: websocket disconnected (${reason}); catch-up cursor ${disconnectAt.toISOString()}`,
          );
        },
        onMessageCreated: async (mid) => {
          try {
            await ingestByMessageId(mid);
          } catch (err) {
            log?.error?.(`Carbon Voice: ingest message ${mid}: ${String(err)}`);
          }
        },
      });

      return waitUntilAbort(abortSignal, () => {
        log?.info?.(`Carbon Voice: stopping account ${accountId}`);
        stream.stop();
        unregisterRoute?.();
        activeRouteUnregisters.delete(routeKey);
      });
    },
    stopAccount: async (
      ctx: ChannelGatewayContext<ReturnType<typeof resolveCarbonVoiceAccount>>,
    ) => {
      ctx.log?.info?.(`Carbon Voice account ${ctx.accountId} stopped`);
    },
  },
};
