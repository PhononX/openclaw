const DEFAULT_BASE_URL = "https://api.carbonvoice.app";

export type CarbonVoiceAuthConfig = {
  apiKey: string;
};

export type CarbonVoiceClientOptions = CarbonVoiceAuthConfig & {
  baseUrl?: string;
};

export type CarbonVoiceUser = {
  user: {
    user_guid: string;
    workspace_guids?: string[];
    [key: string]: unknown;
  };
};

export type CarbonVoiceSubscribeRequest = {
  url: string;
  filters?: unknown;
};

export type CarbonVoiceMessageStartRequest = {
  unique_client_id: string;
  transcript: string;
  is_text_message: boolean;
  channel_id: string;
  reply_to_message_id?: string;
};

export type CarbonVoiceMessage = {
  id: string;
  channel_id: string;
  transcript?: string;
  parent_message_id?: string | null;
  [key: string]: unknown;
};

type HttpMethod = "GET" | "POST";

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
      "x-api-key": opts.apiKey,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Carbon Voice API error ${response.status} ${response.statusText}${
        text ? `: ${text}` : ""
      }`,
    );
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  const json = (await response.json().catch(() => undefined)) as TResponse | undefined;
  return (json ?? (undefined as TResponse)) as TResponse;
}

export async function carbonVoiceHealth(
  opts: CarbonVoiceClientOptions,
): Promise<unknown> {
  return await carbonVoiceRequest<unknown>({
    ...opts,
    method: "GET",
    path: "/health",
  });
}

export async function carbonVoiceWhoAmI(
  opts: CarbonVoiceClientOptions,
): Promise<CarbonVoiceUser> {
  return await carbonVoiceRequest<CarbonVoiceUser>({
    ...opts,
    method: "GET",
    path: "/whoami",
  });
}

export async function carbonVoiceSubscribeToMessages(
  opts: CarbonVoiceClientOptions & {
    clientId: string;
    payload: CarbonVoiceSubscribeRequest;
  },
): Promise<unknown> {
  return await carbonVoiceRequest<unknown>({
    ...opts,
    method: "POST",
    path: `/apps/${encodeURIComponent(opts.clientId)}/subscribe`,
    body: opts.payload,
  });
}

export async function carbonVoiceStartMessage(
  opts: CarbonVoiceClientOptions & {
    payload: CarbonVoiceMessageStartRequest;
  },
): Promise<CarbonVoiceMessage> {
  return await carbonVoiceRequest<CarbonVoiceMessage>({
    ...opts,
    method: "POST",
    path: "/v3/messages/start",
    body: opts.payload,
  });
}

