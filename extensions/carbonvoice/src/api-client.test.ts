import { describe, expect, it } from "vitest";
import { isCarbonVoiceDuplicateWebhookSubscribeError } from "./api-client.js";

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
