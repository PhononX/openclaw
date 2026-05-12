const DEFAULT_BASE_URL = "https://api.carbonvoice.app";

/** Matches cv-api `Label.ACKNOWLEDGED_ID` / `POST reactions/:reaction_id/:message_id`. */
export const CARBONVOICE_ACKNOWLEDGED_REACTION_ID = "acknowledged";

export type CarbonVoiceAuthConfig = {
  apiKey: string;
};

export type CarbonVoiceClientOptions = CarbonVoiceAuthConfig & {
  baseUrl?: string;
  /**
   * Optional sink for each Carbon Voice HTTP call: one "→" line before the request
   * and one "←" line after a response (summaries only; no API keys or full transcripts).
   */
  requestLog?: (message: string) => void;
};

export type CarbonVoiceWhoAmIUser = {
  user_guid?: string;
  _id?: string;
  id?: string;
  [key: string]: unknown;
};

export type CarbonVoiceWhoAmIResponse = {
  success?: boolean;
  user?: CarbonVoiceWhoAmIUser;
  [key: string]: unknown;
};

export type CarbonVoiceMessageStartRequest = {
  unique_client_id: string;
  transcript: string;
  is_text_message: boolean;
  is_streaming: boolean;
  channel_id: string;
  reply_to_message_id?: string | null;
};

export type CarbonVoiceMessageV2 = {
  message_id: string;
  creator_id?: string;
  channel_ids?: string[];
  parent_message_id?: string | null;
  created_at?: string | number | Date;
  [key: string]: unknown;
};

export type CarbonVoiceMessageDetails = {
  _id?: string;
  message_guid?: string;
  creator_guid?: string;
  channel_guids?: string[];
  transcript_txt?: string | null;
  ai_summary_txt?: string | null;
  parent_message_guid?: string | null;
  [key: string]: unknown;
};

export type CarbonVoiceMessageDetailsResponse = {
  message?: CarbonVoiceMessageDetails;
  [key: string]: unknown;
};

/** Body for `POST /v3/messages/recent` (Carbon Voice API v3). */
export type CarbonVoiceRecentMessagesDirection = "older" | "newer";

export type CarbonVoiceRecentMessagesBody = {
  date: string;
  direction: CarbonVoiceRecentMessagesDirection;
  use_last_updated: boolean;
  limit?: number;
  channel_id?: string;
};

type HttpMethod = "GET" | "POST";

function summarizeCarbonVoiceRequestBody(pathname: string, body: unknown): string {
  if (body === undefined || body === null) {
    return "";
  }
  if (pathname.endsWith("/v3/messages/start")) {
    const o = body as Record<string, unknown>;
    const tr = typeof o.transcript === "string" ? o.transcript : "";
    return `body=${JSON.stringify({
      channel_id: o.channel_id,
      reply_to_message_id: o.reply_to_message_id,
      is_text_message: o.is_text_message,
      is_streaming: o.is_streaming,
      unique_client_id: o.unique_client_id,
      transcript_chars: tr.length,
    })}`;
  }
  if (pathname.endsWith("/v3/messages/recent")) {
    return `body=${JSON.stringify(body)}`;
  }
  if (pathname.endsWith("/apps/subscribe")) {
    const o = body as Record<string, unknown>;
    const w = typeof o.webhookURL === "string" ? o.webhookURL : "";
    let webhook_host = "";
    try {
      webhook_host = w ? new URL(w).host : "";
    } catch {
      webhook_host = "";
    }
    return `body=${JSON.stringify({
      subscriptions: o.subscriptions,
      webhook_host,
      webhookURL_len: w.length,
      subscription_filters_count: Array.isArray(o.subscription_filters)
        ? o.subscription_filters.length
        : 0,
    })}`;
  }
  if (pathname.startsWith("/reactions/")) {
    return "body=(none)";
  }
  return "body=(omitted)";
}

function summarizeCarbonVoiceResponseJson(pathname: string, json: unknown): string {
  if (json === undefined || json === null) {
    return "response=(empty)";
  }
  if (!json || typeof json !== "object") {
    return "response=(non-object)";
  }
  if (pathname.endsWith("/v3/messages/start")) {
    const j = json as Record<string, unknown>;
    return `response=${JSON.stringify({
      message_id: j.message_id ?? j.id,
    })}`;
  }
  if (pathname.startsWith("/message/")) {
    const j = json as { message?: { message_guid?: string } };
    return `response=${JSON.stringify({ message_guid: j.message?.message_guid })}`;
  }
  if (pathname.endsWith("/whoami")) {
    return "response=(whoami)";
  }
  if (pathname.endsWith("/v3/messages/recent") && Array.isArray(json)) {
    return `response=messages[] len=${json.length}`;
  }
  if (pathname.startsWith("/reactions/")) {
    return "response=(reaction)";
  }
  return "response=(present)";
}

function firstNonEmptyString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return undefined;
}

export function buildCarbonVoiceAuthHeaders(apiKey: string): Record<string, string> {
  const trimmed = apiKey.trim();
  // Carbon Voice accepts PATs via Bearer auth (`cv_pat_...`) and API keys via `x-api-key`.
  if (trimmed.toLowerCase().startsWith("cv_pat_")) {
    return { Authorization: `Bearer ${trimmed}` };
  }
  return { "x-api-key": trimmed };
}

async function carbonVoiceRequest<TResponse>(
  opts: CarbonVoiceClientOptions & {
    method: HttpMethod;
    path: string;
    searchParams?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  },
): Promise<TResponse> {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = new URL(opts.path, `${baseUrl}/`);
  if (opts.searchParams) {
    for (const [key, value] of Object.entries(opts.searchParams)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const pathname = url.pathname;
  const search = url.search;
  const bodySummary =
    opts.body !== undefined ? summarizeCarbonVoiceRequestBody(pathname, opts.body) : "";
  opts.requestLog?.(
    `Carbon Voice HTTP → ${opts.method} ${pathname}${search}${bodySummary ? ` ${bodySummary}` : ""}`,
  );

  const response = await fetch(url.toString(), {
    method: opts.method,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...buildCarbonVoiceAuthHeaders(opts.apiKey),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    opts.requestLog?.(
      `Carbon Voice HTTP ← ${response.status} ${opts.method} ${pathname}${text ? ` error=${text.slice(0, 500)}${text.length > 500 ? "…" : ""}` : ""}`,
    );
    throw new Error(
      `Carbon Voice API error ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`,
    );
  }

  if (response.status === 204) {
    opts.requestLog?.(`Carbon Voice HTTP ← 204 ${opts.method} ${pathname}`);
    return undefined as TResponse;
  }

  const json = (await response.json().catch(() => undefined)) as TResponse | undefined;
  opts.requestLog?.(
    `Carbon Voice HTTP ← ${response.status} ${opts.method} ${pathname} ${summarizeCarbonVoiceResponseJson(pathname, json)}`,
  );
  return (json ?? (undefined as TResponse)) as TResponse;
}

export async function carbonVoiceHealth(opts: CarbonVoiceClientOptions): Promise<unknown> {
  return await carbonVoiceRequest<unknown>({
    ...opts,
    method: "GET",
    path: "/health",
  });
}

export async function carbonVoiceWhoAmI(
  opts: CarbonVoiceClientOptions,
): Promise<CarbonVoiceWhoAmIResponse> {
  return await carbonVoiceRequest<CarbonVoiceWhoAmIResponse>({
    ...opts,
    method: "GET",
    path: "/whoami",
  });
}

export function resolveCarbonVoiceWhoAmIUserId(
  who: CarbonVoiceWhoAmIResponse | undefined,
): string | undefined {
  const user = who?.user;
  if (!user || typeof user !== "object") {
    return undefined;
  }
  const guid = user.user_guid ?? user._id ?? user.id;
  if (typeof guid === "string" && guid.trim()) {
    return guid.trim();
  }
  return undefined;
}

/**
 * True when subscribe failed because this webhook URL is already registered (gateway restart / duplicate subscribe).
 * Matches {@link carbonVoiceRequest} error text: `Carbon Voice API error 400 ...` plus body mentioning same webhook URL.
 */
export function isCarbonVoiceDuplicateWebhookSubscribeError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const msg = err.message;
  if (!msg.includes("Carbon Voice API error 400")) {
    return false;
  }
  return msg.toLowerCase().includes("same webhook url");
}

export async function carbonVoiceSubscribeToMessages(
  opts: CarbonVoiceClientOptions & {
    payload: unknown;
  },
): Promise<unknown> {
  return await carbonVoiceRequest<unknown>({
    ...opts,
    method: "POST",
    path: `/apps/subscribe`,
    body: opts.payload,
  });
}

export async function carbonVoiceStartMessage(
  opts: CarbonVoiceClientOptions & {
    payload: CarbonVoiceMessageStartRequest;
  },
): Promise<CarbonVoiceMessageV2> {
  return await carbonVoiceRequest<CarbonVoiceMessageV2>({
    ...opts,
    method: "POST",
    path: "/v3/messages/start",
    body: opts.payload,
  });
}

/**
 * Adds the standard "Acknowledged" reaction as the authenticated user (PAT / API key).
 * Calls `POST /reactions/acknowledged/:message_id` (cv-api `ReactionController.addReactionToMessage`).
 */
export async function carbonVoiceAddAcknowledgedReaction(
  opts: CarbonVoiceClientOptions & {
    messageId: string;
  },
): Promise<unknown> {
  const reactionId = CARBONVOICE_ACKNOWLEDGED_REACTION_ID;
  return await carbonVoiceRequest<unknown>({
    ...opts,
    method: "POST",
    path: `/reactions/${encodeURIComponent(reactionId)}/${encodeURIComponent(opts.messageId.trim())}`,
  });
}

export async function carbonVoiceGetMessageById(
  opts: CarbonVoiceClientOptions & { messageId: string },
): Promise<CarbonVoiceMessageDetailsResponse> {
  return await carbonVoiceRequest<CarbonVoiceMessageDetailsResponse>({
    ...opts,
    method: "GET",
    path: `/message/${encodeURIComponent(opts.messageId)}`,
  });
}

/** Transcript or summary from `GET /message/:id` message payload. */
export function carbonVoiceExtractTranscriptFromMessageDetails(
  message: CarbonVoiceMessageDetails | undefined,
): string {
  return firstNonEmptyString(message?.transcript_txt, message?.ai_summary_txt)?.trim() ?? "";
}

/**
 * Map `GET /message/:id` JSON to inbound delivery args (same ids as webhook resource).
 */
export function carbonVoiceDeliverArgsFromMessageDetailsResponse(
  res: CarbonVoiceMessageDetailsResponse,
):
  | {
      body: string;
      channelGuid: string;
      messageGuid: string;
      creatorGuid: string;
      replyToCarbonMessageId: string;
    }
  | undefined {
  const resource = res.message;
  if (!resource || typeof resource !== "object") {
    return undefined;
  }
  const chGuids = Array.isArray(resource.channel_guids)
    ? resource.channel_guids.filter((x): x is string => typeof x === "string")
    : [];
  const channelGuid = firstNonEmptyString(
    ...chGuids,
    resource.channel_guid,
    (resource as { channel_id?: unknown }).channel_id,
  );
  const messageGuid = firstNonEmptyString(
    resource.message_guid,
    typeof resource._id === "string" ? resource._id : undefined,
    (resource as { message_id?: unknown }).message_id,
  );
  const creatorGuid = firstNonEmptyString(
    resource.creator_guid,
    (resource as { creator_id?: unknown }).creator_id,
  );
  if (!channelGuid || !messageGuid || !creatorGuid) {
    return undefined;
  }
  const body = carbonVoiceExtractTranscriptFromMessageDetails(resource);
  if (!body) {
    return undefined;
  }
  const parent = firstNonEmptyString(
    resource.parent_message_guid,
    (resource as { parent_message_id?: unknown }).parent_message_id,
  );
  const replyToCarbonMessageId = parent ?? messageGuid;
  return { body, channelGuid, messageGuid, creatorGuid, replyToCarbonMessageId };
}

/** Prefer `text_models[].value` for text rows; otherwise callers may fall back to {@link carbonVoiceGetMessageById}. */
export function carbonVoiceExtractTextFromMessageV2Row(row: unknown): string | undefined {
  if (!row || typeof row !== "object") {
    return undefined;
  }
  const o = row as Record<string, unknown>;
  if (o.is_text_message === true && Array.isArray(o.text_models)) {
    for (const m of o.text_models) {
      if (m && typeof m === "object") {
        const v = (m as Record<string, unknown>).value;
        if (typeof v === "string" && v.trim()) {
          return v.trim();
        }
      }
    }
  }
  return undefined;
}

export async function carbonVoiceGetRecentMessages(
  opts: CarbonVoiceClientOptions & { body: CarbonVoiceRecentMessagesBody },
): Promise<CarbonVoiceMessageV2[]> {
  const data = await carbonVoiceRequest<unknown>({
    ...opts,
    method: "POST",
    path: "/v3/messages/recent",
    body: opts.body,
  });
  if (!Array.isArray(data)) {
    return [];
  }
  return data as CarbonVoiceMessageV2[];
}

/**
 * Same inbound filter semantics as webhook subscribe filters (creator_id ne self; optional eq restrict).
 */
export function carbonVoiceInboundCreatorMatchesSubscriptionFilter(params: {
  selfUserId: string;
  creatorId: string;
  restrictInboundToCreatorId?: string;
}): boolean {
  const self = params.selfUserId.trim();
  const creator = params.creatorId.trim();
  if (!self || !creator || creator === self) {
    return false;
  }
  const only = params.restrictInboundToCreatorId?.trim();
  if (only && creator !== only) {
    return false;
  }
  return true;
}
