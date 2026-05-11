const DEFAULT_BASE_URL = "https://api.carbonvoice.app";

export type CarbonVoiceAuthConfig = {
  apiKey: string;
};

export type CarbonVoiceClientOptions = CarbonVoiceAuthConfig & {
  baseUrl?: string;
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

type HttpMethod = "GET" | "POST";

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
    throw new Error(
      `Carbon Voice API error ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`,
    );
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  const json = (await response.json().catch(() => undefined)) as TResponse | undefined;
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

export async function carbonVoiceGetMessageById(
  opts: CarbonVoiceClientOptions & { messageId: string },
): Promise<CarbonVoiceMessageDetailsResponse> {
  return await carbonVoiceRequest<CarbonVoiceMessageDetailsResponse>({
    ...opts,
    method: "GET",
    path: `/message/${encodeURIComponent(opts.messageId)}`,
  });
}
