import { describe, expect, it } from "vitest";
import { buildCarbonVoiceSubscribePayload } from "./subscribe.js";
import { CARBONVOICE_MESSAGE_POSTED_EVENT } from "./webhook-payload.js";

describe("buildCarbonVoiceSubscribePayload", () => {
  it("subscribes to message.posted.to.channel and excludes self", () => {
    const body = buildCarbonVoiceSubscribePayload({
      webhookUrl: "https://gw.example.com/hook",
      selfUserId: "user-self",
    });
    expect(body.subscriptions).toEqual([CARBONVOICE_MESSAGE_POSTED_EVENT]);
    expect(body.webhookURL).toBe("https://gw.example.com/hook");
    expect(body.subscription_filters).toEqual([
      { key: "creator_id", operator: "ne", value: "user-self" },
    ]);
  });

  it("adds optional creator_id eq filter", () => {
    const body = buildCarbonVoiceSubscribePayload({
      webhookUrl: "https://gw.example.com/hook",
      selfUserId: "user-self",
      restrictInboundToCreatorId: "only-them",
    });
    expect(body.subscription_filters).toEqual([
      { key: "creator_id", operator: "ne", value: "user-self" },
      { key: "creator_id", operator: "eq", value: "only-them" },
    ]);
  });
});
