/* WebSocket types for HMR */

/* WebSocket ready state constant */
export const WS_READY_STATE_OPEN = 1;

/* Minimal WebSocket interface for HMR clients
   Compatible with Elysia's WebSocket implementation */
export interface HMRWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
}
