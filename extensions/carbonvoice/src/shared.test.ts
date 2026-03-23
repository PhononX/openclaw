import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../../src/config/config.js";
import { CARBONVOICE_DEFAULT_BASE_URL, resolveCarbonVoiceAccount } from "./shared.js";

describe("resolveCarbonVoiceAccount", () => {
  it("requires apiKey and creatorId", () => {
    const cfg = {
      channels: {
        carbonvoice: {
          accounts: {
            default: {
              apiKey: "secret",
              creatorId: "user-guid",
            },
          },
        },
      },
    } as OpenClawConfig;
    const a = resolveCarbonVoiceAccount({ cfg, accountId: "default" });
    expect(a.configured).toBe(true);
    expect(a.baseUrl).toBe(CARBONVOICE_DEFAULT_BASE_URL);
  });

  it("reports unconfigured when creatorId is missing", () => {
    const cfg = {
      channels: {
        carbonvoice: {
          accounts: {
            default: {
              apiKey: "secret",
            },
          },
        },
      },
    } as OpenClawConfig;
    const a = resolveCarbonVoiceAccount({ cfg, accountId: "default" });
    expect(a.configured).toBe(false);
    expect(a.unconfiguredReason).toMatch(/creatorId/);
  });
});
