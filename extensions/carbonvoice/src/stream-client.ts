import { io, type Socket } from "socket.io-client";
import { buildCarbonVoiceAuthHeaders } from "./api-client.js";

export type CarbonVoiceStreamClient = {
  stop: () => void;
};

export function startCarbonVoiceMessageStream(params: {
  baseUrl: string;
  apiKey: string;
  log?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
  onMessageCreated: (messageId: string) => Promise<void>;
  onConnected?: (info: { socketId?: string }) => void | Promise<void>;
  onDisconnected?: (info: { reason: string }) => void | Promise<void>;
}): CarbonVoiceStreamClient {
  const headers = buildCarbonVoiceAuthHeaders(params.apiKey);
  params.log?.info?.(`Carbon Voice websocket connecting to ${params.baseUrl}`);
  const socket: Socket = io(params.baseUrl, {
    transports: ["websocket"],
    extraHeaders: headers,
  });

  socket.on("connect", () => {
    params.log?.info?.(`Carbon Voice websocket connected (${socket.id})`);
    void Promise.resolve(params.onConnected?.({ socketId: socket.id })).catch((err: unknown) => {
      params.log?.error?.(`Carbon Voice websocket onConnected error: ${String(err)}`);
    });
  });
  socket.on("disconnect", (reason) => {
    params.log?.warn?.(`Carbon Voice websocket disconnected: ${reason}`);
    void Promise.resolve(params.onDisconnected?.({ reason: String(reason) })).catch(
      (err: unknown) => {
        params.log?.error?.(`Carbon Voice websocket onDisconnected error: ${String(err)}`);
      },
    );
  });
  socket.on("connect_error", (err) => {
    params.log?.error?.(`Carbon Voice websocket connect error: ${String(err)}`);
  });

  socket.on("message:created", (payload: { _id?: string } | string | null | undefined) => {
    params.log?.info?.(`Carbon Voice websocket message created: ${JSON.stringify(payload)}`);
    const messageId =
      typeof payload === "string"
        ? payload
        : typeof payload?._id === "string"
          ? payload._id
          : undefined;
    if (!messageId?.trim()) {
      return;
    }
    void params.onMessageCreated(messageId.trim());
  });

  return {
    stop: () => {
      socket.removeAllListeners("message:created");
      socket.removeAllListeners("connect");
      socket.removeAllListeners("disconnect");
      socket.removeAllListeners("connect_error");
      socket.disconnect();
    },
  };
}
