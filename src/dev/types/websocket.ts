/* WebSocket types for HMR */

/* WebSocket ready state constants */
export const WS_READY_STATE_CONNECTING = 0;
export const WS_READY_STATE_OPEN = 1;
export const WS_READY_STATE_CLOSING = 2;
export const WS_READY_STATE_CLOSED = 3;

/* Minimal WebSocket interface for HMR clients
   Compatible with Elysia's WebSocket implementation */
export interface HMRWebSocket {
  send(data: string): void;
  readyState: number;
}

