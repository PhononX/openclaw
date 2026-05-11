import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChannelLogSink } from "openclaw/plugin-sdk/channel-contract";
import { readJsonBodyWithLimit } from "openclaw/plugin-sdk/webhook-request-guards";
import type { CarbonVoiceResolvedAccount } from "./shared.js";
import {
  CARBONVOICE_MESSAGE_POSTED_EVENT,
  type CarbonVoiceWebhookMessageResource,
  type CarbonVoiceWebhookPayload,
} from "./webhook-payload.js";

const WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
const WEBHOOK_BODY_TIMEOUT_MS = 30_000;

const DEDUPE_MAX = 10_000;

function timingSafeEqualString(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) {
    return false;
  }
  return timingSafeEqual(ae, be);
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return undefined;
}

function extractInboundBody(resource: CarbonVoiceWebhookMessageResource): string {
  return firstString(resource.transcript_txt, resource.ai_summary_txt)?.trim() ?? "";
}

export type CarbonVoiceWebhookDeliverArgs = {
  body: string;
  channelGuid: string;
  messageGuid: string;
  creatorGuid: string;
  /** `reply_to_message_id` for `/v3/messages/start` (thread parent if present). */
  replyToCarbonMessageId: string;
};

function respondJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function respondNoContent(res: ServerResponse) {
  res.writeHead(204);
  res.end();
}

export function createCarbonVoiceWebhookHandler(params: {
  account: CarbonVoiceResolvedAccount;
  deliver: (msg: CarbonVoiceWebhookDeliverArgs) => Promise<void>;
  /** Dedupe recent message_guid per handler instance */
  recentMessageIds: Set<string>;
  log?: Pick<ChannelLogSink, "info" | "warn" | "error">;
}) {
  const { account, deliver, recentMessageIds, log } = params;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const expectedHeader = account.webhookAuthHeaderName?.trim();
    const expectedValue = account.webhookAuthHeaderValue?.trim();
    if (expectedHeader && expectedValue) {
      const raw = req.headers[expectedHeader.toLowerCase()];
      const got = Array.isArray(raw) ? raw[0] : raw;
      if (!got || !timingSafeEqualString(String(got).trim(), expectedValue)) {
        log?.warn("carbonvoice: webhook auth header mismatch");
        respondJson(res, 401, { error: "Unauthorized" });
        return;
      }
    }

    const readResult = await readJsonBodyWithLimit(req, {
      maxBytes: WEBHOOK_MAX_BODY_BYTES,
      timeoutMs: WEBHOOK_BODY_TIMEOUT_MS,
    });
    if (!readResult.ok) {
      if (
        readResult.code === "PAYLOAD_TOO_LARGE" ||
        readResult.code === "REQUEST_BODY_TIMEOUT" ||
        readResult.code === "CONNECTION_CLOSED"
      ) {
        log?.warn(`carbonvoice: webhook body error: ${readResult.error}`);
        const status =
          readResult.code === "PAYLOAD_TOO_LARGE"
            ? 413
            : readResult.code === "REQUEST_BODY_TIMEOUT"
              ? 408
              : 400;
        respondJson(res, status, { error: readResult.error });
        return;
      }
      log?.warn(`carbonvoice: invalid webhook JSON: ${readResult.error}`);
      respondJson(res, 400, { error: readResult.error });
      return;
    }

    const payload = readResult.value as CarbonVoiceWebhookPayload;
    if (log) {
      log.info(`carbonvoice: webhook payload: ${JSON.stringify(payload)}`);
    }
    if (!payload || typeof payload !== "object") {
      respondJson(res, 400, { error: "Invalid payload" });
      return;
    }
    if (payload.eventName !== CARBONVOICE_MESSAGE_POSTED_EVENT) {
      respondNoContent(res);
      return;
    }

    const resource = payload.data?.resource as CarbonVoiceWebhookMessageResource | undefined;
    if (!resource || typeof resource !== "object") {
      log?.warn("carbonvoice: webhook missing data.resource");
      respondJson(res, 400, { error: "Missing resource" });
      return;
    }

    const channelGuid = firstString(resource.channel_guid, resource.channel_id);
    const messageGuid = firstString(resource.message_guid, resource.message_id);
    const creatorGuid = firstString(resource.creator_guid, resource.creator_id);

    if (!channelGuid || !messageGuid || !creatorGuid) {
      log?.warn("carbonvoice: webhook missing channel/message/creator id");
      respondJson(res, 400, { error: "Missing identifiers" });
      return;
    }

    const body = extractInboundBody(resource);
    if (!body) {
      respondNoContent(res);
      return;
    }

    if (recentMessageIds.has(messageGuid)) {
      respondNoContent(res);
      return;
    }
    recentMessageIds.add(messageGuid);
    if (recentMessageIds.size > DEDUPE_MAX) {
      recentMessageIds.clear();
    }

    const parent = firstString(resource.parent_message_guid, resource.parent_message_id);
    const replyToCarbonMessageId = parent ?? messageGuid;
    respondNoContent(res);

    try {
      await deliver({
        body,
        channelGuid,
        messageGuid,
        creatorGuid,
        replyToCarbonMessageId,
      });
    } catch (err) {
      log?.error(`carbonvoice: deliver failed: ${String(err)}`);
    }
  };
}
