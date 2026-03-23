import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import * as httpBody from "../../../src/infra/http-body.js";
import type { CarbonVoiceResolvedAccount } from "./shared.js";
import { createCarbonVoiceWebhookHandler } from "./webhook-handler.js";
import { CARBONVOICE_MESSAGE_POSTED_EVENT } from "./webhook-payload.js";

function mockReqRes(method: string): { req: IncomingMessage; res: ServerResponse } {
  const writeHead = vi.fn();
  const end = vi.fn();
  const res = { writeHead, end } as unknown as ServerResponse;
  const req = { method, headers: {}, socket: { remoteAddress: "127.0.0.1" } } as IncomingMessage;
  return { req, res };
}

describe("createCarbonVoiceWebhookHandler", () => {
  it("rejects wrong webhook auth header when configured", async () => {
    vi.spyOn(httpBody, "readJsonBodyWithLimit").mockResolvedValue({
      ok: true,
      value: { eventName: CARBONVOICE_MESSAGE_POSTED_EVENT },
    });
    const account = {
      accountId: "default",
      enabled: true,
      configured: true,
      webhookAuthHeaderName: "x-cv-auth",
      webhookAuthHeaderValue: "secret",
      config: {},
    } as CarbonVoiceResolvedAccount;

    const handler = createCarbonVoiceWebhookHandler({
      account,
      recentMessageIds: new Set(),
      deliver: vi.fn(),
    });
    const { req, res } = mockReqRes("POST");
    req.headers["x-cv-auth"] = "wrong";

    await handler(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(401, {
      "Content-Type": "application/json; charset=utf-8",
    });
  });

  it("acknowledges non message.posted events with 204", async () => {
    vi.spyOn(httpBody, "readJsonBodyWithLimit").mockResolvedValue({
      ok: true,
      value: { eventName: "channel.created" },
    });
    const account = {
      accountId: "default",
      enabled: true,
      configured: true,
      config: {},
    } as CarbonVoiceResolvedAccount;
    const handler = createCarbonVoiceWebhookHandler({
      account,
      recentMessageIds: new Set(),
      deliver: vi.fn(),
    });
    const { req, res } = mockReqRes("POST");
    await handler(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(204);
  });
});
