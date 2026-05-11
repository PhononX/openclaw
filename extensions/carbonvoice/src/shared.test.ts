import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../../src/config/config.js";
import { CARBONVOICE_DEFAULT_BASE_URL, resolveCarbonVoiceAccount } from "./shared.js";

describe("resolveCarbonVoiceAccount", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires apiKey and publicWebhookBaseUrl (not creatorId)", () => {
    const cfg = {
      channels: {
        carbonvoice: {
          accounts: {
            default: {
              apiKey: "cv_pat_secret",
              publicWebhookBaseUrl: "https://gateway.example.com",
            },
          },
        },
      },
    } as OpenClawConfig;
    const a = resolveCarbonVoiceAccount({ cfg, accountId: "default" });
    expect(a.configured).toBe(true);
    expect(a.baseUrl).toBe(CARBONVOICE_DEFAULT_BASE_URL);
    expect(a.creatorId).toBeUndefined();
  });

  it("reports unconfigured when apiKey is missing", () => {
    const cfg = {
      channels: {
        carbonvoice: {
          accounts: {
            default: {
              publicWebhookBaseUrl: "https://gateway.example.com",
            },
          },
        },
      },
    } as OpenClawConfig;
    const a = resolveCarbonVoiceAccount({ cfg, accountId: "default" });
    expect(a.configured).toBe(false);
    expect(a.unconfiguredReason).toMatch(/apiKey|AGENT_PAT/);
  });

  it("resolves AGENT_PAT for default account when apiKey unset", () => {
    vi.stubEnv("AGENT_PAT", "cv_pat_from_env");
    const cfg = {
      channels: {
        carbonvoice: {
          accounts: {
            default: {
              publicWebhookBaseUrl: "https://gateway.example.com",
            },
          },
        },
      },
    } as OpenClawConfig;
    const a = resolveCarbonVoiceAccount({ cfg, accountId: "default" });
    expect(a.apiKey).toBe("cv_pat_from_env");
    expect(a.configured).toBe(true);
  });
});
