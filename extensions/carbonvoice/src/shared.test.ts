import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../../src/config/config.js";
import {
  CARBONVOICE_DEFAULT_BASE_URL,
  normalizeCarbonVoiceTarget,
  resolveCarbonVoiceAccount,
} from "./shared.js";

describe("normalizeCarbonVoiceTarget", () => {
  it.each([
    ["ch1", "ch1"],
    [" carbonvoice:ch1 ", "ch1"],
    ["carbonvoice:channel:ch1", "ch1"],
    ["carbonvoice:conversation:ch1", "ch1"],
    ["carbonvoice:direct:ch1", "ch1"],
    ["channel:ch1", "ch1"],
    ["conversation:ch1", "ch1"],
    ["direct:ch1", "ch1"],
    ["", undefined],
    [" carbonvoice: ", undefined],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeCarbonVoiceTarget(input)).toBe(expected);
  });
});

describe("resolveCarbonVoiceAccount", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires apiKey only; publicWebhookBaseUrl optional (PAT-only mode)", () => {
    const cfg = {
      channels: {
        carbonvoice: {
          accounts: {
            default: {
              apiKey: "cv_pat_secret",
            },
          },
        },
      },
    } as OpenClawConfig;
    const a = resolveCarbonVoiceAccount({ cfg, accountId: "default" });
    expect(a.configured).toBe(true);
    expect(a.publicWebhookBaseUrl).toBeUndefined();
    expect(a.baseUrl).toBe(CARBONVOICE_DEFAULT_BASE_URL);
    expect(a.creatorId).toBeUndefined();
  });

  it("requires apiKey and accepts publicWebhookBaseUrl when set", () => {
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

  it("resolves AGENT_PAT for default account when apiKey unset (PAT-only)", () => {
    vi.stubEnv("AGENT_PAT", "cv_pat_from_env");
    const cfg = {
      channels: {
        carbonvoice: {
          accounts: {
            default: {},
          },
        },
      },
    } as OpenClawConfig;
    const a = resolveCarbonVoiceAccount({ cfg, accountId: "default" });
    expect(a.apiKey).toBe("cv_pat_from_env");
    expect(a.configured).toBe(true);
  });

  it("resolves AGENT_PAT for default account when apiKey unset with webhook URL", () => {
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
