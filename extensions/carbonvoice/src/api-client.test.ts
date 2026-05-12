import { afterEach, describe, expect, it, vi } from "vitest";
import {
  carbonVoiceAddAcknowledgedReaction,
  carbonVoiceDeliverArgsFromMessageDetailsResponse,
  carbonVoiceGetRecentMessages,
  carbonVoiceInboundCreatorMatchesSubscriptionFilter,
  carbonVoiceStartMessage,
  isCarbonVoiceDuplicateWebhookSubscribeError,
} from "./api-client.js";

describe("isCarbonVoiceDuplicateWebhookSubscribeError", () => {
  it("returns true for 400 subscribe error body mentioning same webhook URL", () => {
    const err = new Error(
      'Carbon Voice API error 400 Bad Request: {"errmsg":"same webhook URL already in use"}',
    );
    expect(isCarbonVoiceDuplicateWebhookSubscribeError(err)).toBe(true);
  });

  it("matches case-insensitively", () => {
    const err = new Error(
      "Carbon Voice API error 400 Bad Request: Same Webhook URL already registered",
    );
    expect(isCarbonVoiceDuplicateWebhookSubscribeError(err)).toBe(true);
  });

  it("returns false for other 400 errors", () => {
    const err = new Error("Carbon Voice API error 400 Bad Request: invalid payload");
    expect(isCarbonVoiceDuplicateWebhookSubscribeError(err)).toBe(false);
  });

  it("returns false for 500 with same phrase in body", () => {
    const err = new Error(
      "Carbon Voice API error 500 Internal Server Error: same webhook URL (transient)",
    );
    expect(isCarbonVoiceDuplicateWebhookSubscribeError(err)).toBe(false);
  });

  it("returns false for non-Error", () => {
    expect(isCarbonVoiceDuplicateWebhookSubscribeError("boom")).toBe(false);
  });
});

describe("carbonVoiceGetRecentMessages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs /v3/messages/recent with JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => [{ message_id: "m1" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const cursor = new Date("2026-01-02T03:04:05.000Z");
    const rows = await carbonVoiceGetRecentMessages({
      apiKey: "cv_pat_test",
      baseUrl: "https://api.example.test",
      body: {
        date: cursor.toISOString(),
        direction: "newer",
        use_last_updated: false,
        limit: 50,
      },
    });

    expect(rows).toEqual([{ message_id: "m1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.test/v3/messages/recent");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json; charset=utf-8",
      Authorization: "Bearer cv_pat_test",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      date: "2026-01-02T03:04:05.000Z",
      direction: "newer",
      use_last_updated: false,
      limit: 50,
    });
  });

  it("returns empty array when response is not an array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({}),
      }),
    );
    const rows = await carbonVoiceGetRecentMessages({
      apiKey: "k",
      baseUrl: "https://api.example.test",
      body: {
        date: new Date().toISOString(),
        direction: "newer",
        use_last_updated: false,
      },
    });
    expect(rows).toEqual([]);
  });
});

describe("carbonVoiceAddAcknowledgedReaction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs /reactions/acknowledged/:messageId with PAT auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await carbonVoiceAddAcknowledgedReaction({
      apiKey: "cv_pat_test",
      baseUrl: "https://api.example.test",
      messageId: "msg-guid-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.test/reactions/acknowledged/msg-guid-1");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json; charset=utf-8",
      Authorization: "Bearer cv_pat_test",
    });
    expect(init.body).toBeUndefined();
  });
});

describe("carbonVoiceStartMessage requestLog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("logs HTTP → and ← lines on success", async () => {
    const logs: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ message_id: "mid1" }),
      }),
    );
    await carbonVoiceStartMessage({
      apiKey: "cv_pat_test",
      baseUrl: "https://api.example.test",
      requestLog: (m) => {
        logs.push(m);
      },
      payload: {
        unique_client_id: "client-1",
        transcript: "hi",
        is_text_message: true,
        is_streaming: false,
        channel_id: "ch1",
        reply_to_message_id: "parent1",
      },
    });
    expect(
      logs.some((l) => l.includes("Carbon Voice HTTP →") && l.includes("/v3/messages/start")),
    ).toBe(true);
    expect(logs.some((l) => l.includes("Carbon Voice HTTP ←") && l.includes("mid1"))).toBe(true);
  });
});

describe("carbonVoiceInboundCreatorMatchesSubscriptionFilter", () => {
  it("excludes self creator", () => {
    expect(
      carbonVoiceInboundCreatorMatchesSubscriptionFilter({
        selfUserId: "u1",
        creatorId: "u1",
      }),
    ).toBe(false);
  });

  it("excludes empty creator", () => {
    expect(
      carbonVoiceInboundCreatorMatchesSubscriptionFilter({
        selfUserId: "u1",
        creatorId: "",
      }),
    ).toBe(false);
  });

  it("includes other creator", () => {
    expect(
      carbonVoiceInboundCreatorMatchesSubscriptionFilter({
        selfUserId: "u1",
        creatorId: "u2",
      }),
    ).toBe(true);
  });

  it("applies restrictInboundToCreatorId", () => {
    expect(
      carbonVoiceInboundCreatorMatchesSubscriptionFilter({
        selfUserId: "u1",
        creatorId: "u2",
        restrictInboundToCreatorId: "u3",
      }),
    ).toBe(false);
    expect(
      carbonVoiceInboundCreatorMatchesSubscriptionFilter({
        selfUserId: "u1",
        creatorId: "u3",
        restrictInboundToCreatorId: "u3",
      }),
    ).toBe(true);
  });
});

describe("carbonVoiceDeliverArgsFromMessageDetailsResponse", () => {
  it("maps message details to deliver args", () => {
    const args = carbonVoiceDeliverArgsFromMessageDetailsResponse({
      message: {
        channel_guids: ["ch1"],
        message_guid: "mg1",
        creator_guid: "cr1",
        transcript_txt: "hello",
        parent_message_guid: "parent1",
      },
    });
    expect(args).toEqual({
      body: "hello",
      channelGuid: "ch1",
      messageGuid: "mg1",
      creatorGuid: "cr1",
      replyToCarbonMessageId: "parent1",
    });
  });

  it("uses message id as reply parent when parent missing", () => {
    const args = carbonVoiceDeliverArgsFromMessageDetailsResponse({
      message: {
        channel_guid: "ch1",
        message_guid: "mg1",
        creator_guid: "cr1",
        transcript_txt: "hi",
      },
    });
    expect(args?.replyToCarbonMessageId).toBe("mg1");
  });
});
