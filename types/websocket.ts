/* WebSocket ready state constant */
export const WS_READY_STATE_OPEN = 1;

/* Minimal WebSocket interface for HMR clients
   Compatible with Elysia's WebSocket implementation */
export type HMRWebSocket = {
	send(data: string): void;
	close(code?: number, reason?: string): void;
	readyState: number;
	/* The underlying Bun ServerWebSocket. Elysia 2 builds a fresh wrapper
	   for every open/message/close event, so the wrapper is not a stable
	   identity for a connection; `raw` is. */
	raw?: object;
};
