import { CARBONVOICE_MESSAGE_POSTED_EVENT } from "./webhook-payload.js";

export type CarbonVoiceSubscribeFilter = {
  key: string;
  operator: "eq" | "ne" | "in";
  value: string | number | string[];
};

export type CarbonVoiceSubscribeRequestBody = {
  subscriptions: string[];
  webhookURL: string;
  subscription_filters?: CarbonVoiceSubscribeFilter[];
};

/**
 * Build the POST body for `POST /apps/subscribe` (strict-spec).
 * Filters use message `creator_id` on the server side (matches Mongo message schema).
 */
export function buildCarbonVoiceSubscribePayload(params: {
  webhookUrl: string;
  selfUserId: string;
  restrictInboundToCreatorId?: string;
}): CarbonVoiceSubscribeRequestBody {
  const filters: CarbonVoiceSubscribeFilter[] = [
    { key: "creator_id", operator: "ne", value: params.selfUserId },
  ];
  const only = params.restrictInboundToCreatorId?.trim();
  if (only) {
    filters.push({ key: "creator_id", operator: "eq", value: only });
  }
  return {
    subscriptions: [CARBONVOICE_MESSAGE_POSTED_EVENT],
    webhookURL: params.webhookUrl,
    subscription_filters: filters,
  };
}
