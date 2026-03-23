/** Carbon Voice outbound webhook shape (POST from api.carbonvoice.app). */

export const CARBONVOICE_MESSAGE_POSTED_EVENT = "message.posted.to.channel" as const;

export type CarbonVoiceWebhookMessageResource = {
  message_guid?: string;
  creator_guid?: string;
  channel_guid?: string;
  workspace_guid?: string;
  transcript_txt?: string | null;
  ai_summary_txt?: string | null;
  parent_message_guid?: string | null;
  [key: string]: unknown;
};

export type CarbonVoiceWebhookPayload = {
  eventName?: string;
  subscribedUserIds?: string[];
  data?: {
    resourceId?: string;
    resourceType?: string;
    resource?: CarbonVoiceWebhookMessageResource;
  };
};

export function isCarbonVoiceMessagePostedPayload(raw: unknown): raw is CarbonVoiceWebhookPayload {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const o = raw as Record<string, unknown>;
  return o.eventName === CARBONVOICE_MESSAGE_POSTED_EVENT;
}
