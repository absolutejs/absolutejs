/**
 * Reverse-tunnel wire protocol (pure Bun, no third-party deps).
 *
 * A dev machine behind NAT cannot accept inbound connections, so the dev
 * `client` dials OUT to a public `relay` over a single control WebSocket. The
 * relay receives public HTTP requests and forwards each one down that socket;
 * the client replays it against the local app and sends the response back.
 *
 * Stage 1 covers HTTP request/response (webhooks). WebSocket passthrough for
 * telephony media streams is layered on later with additional message types.
 */

/** Control-channel path the client connects to on the relay. */
export const TUNNEL_CONTROL_PATH = '/__abs_tunnel/control';

/** Header the relay strips/sets; lets the app know its public origin. */
export const TUNNEL_FORWARDED_HOST_HEADER = 'x-absolute-tunnel-host';

/** A forwarded HTTP request (relay → client). Body is base64 (binary-safe). */
export type TunnelRequestMessage = {
	type: 'request';
	id: string;
	method: string;
	/** Path + query, e.g. `/v1/sms/intake?x=1`. */
	url: string;
	headers: Record<string, string>;
	bodyBase64?: string;
};

/** The client's response to a forwarded request (client → relay). */
export type TunnelResponseMessage = {
	type: 'response';
	id: string;
	status: number;
	headers: Record<string, string>;
	bodyBase64?: string;
};

/** Client could not produce a response (local app down, fetch threw). */
export type TunnelErrorMessage = {
	type: 'error';
	id: string;
	message: string;
};

/** Sent by the relay right after a successful auth handshake. */
export type TunnelReadyMessage = {
	type: 'ready';
	/** Public base URL the relay is reachable at, e.g. `https://x.app`. */
	publicUrl: string;
};

// --- WebSocket passthrough (Stage 2) -----------------------------------------
// A public WebSocket (e.g. a Twilio Media Stream) is tunneled by id over the
// same control channel: the relay asks the client to open a matching local WS,
// then both sides forward frames tagged with that id until either end closes.

/** A public WS connection opened; client should dial the local app (relay → client). */
export type TunnelWsOpenMessage = {
	type: 'ws_open';
	id: string;
	/** Path + query of the upgraded request. */
	url: string;
	headers: Record<string, string>;
};

/** Result of the client opening the local WS (client → relay). */
export type TunnelWsOpenAckMessage = {
	type: 'ws_open_ack';
	id: string;
	ok: boolean;
	error?: string;
};

/** One WS frame, either direction. Binary frames are base64. */
export type TunnelWsDataMessage = {
	type: 'ws_data';
	id: string;
	dataBase64: string;
	binary: boolean;
};

/** A WS closed, either direction. */
export type TunnelWsCloseMessage = {
	type: 'ws_close';
	id: string;
	code?: number;
	reason?: string;
};

/** App-level keepalive (either direction). */
export type TunnelPingMessage = { type: 'ping' };
export type TunnelPongMessage = { type: 'pong' };

export type TunnelClientMessage =
	| TunnelResponseMessage
	| TunnelErrorMessage
	| TunnelWsOpenAckMessage
	| TunnelWsDataMessage
	| TunnelWsCloseMessage
	| TunnelPongMessage
	| TunnelPingMessage;
export type TunnelServerMessage =
	| TunnelRequestMessage
	| TunnelReadyMessage
	| TunnelWsOpenMessage
	| TunnelWsDataMessage
	| TunnelWsCloseMessage
	| TunnelPingMessage
	| TunnelPongMessage;

export const decodeTunnelMessage = (raw: string) => {
	try {
		const parsed: TunnelClientMessage | TunnelServerMessage = JSON.parse(raw);

		return parsed;
	} catch {
		return null;
	}
};
export const encodeTunnelMessage = (message: TunnelClientMessage | TunnelServerMessage) =>
	JSON.stringify(message);
