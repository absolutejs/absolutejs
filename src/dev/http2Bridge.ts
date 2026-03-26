import type {
	Http2SecureServer,
	IncomingHttpHeaders,
	ServerHttp2Stream
} from 'node:http2';
import type { HMRWebSocket } from '../../types/websocket';
import { WS_READY_STATE_OPEN } from '../../types/websocket';
import type { HMRState } from './clientManager';
import {
	handleClientConnect,
	handleClientDisconnect,
	handleHMRMessage
} from './webSocket';

/* Minimal WebSocket frame parser/writer for RFC 8441 h2 streams.
   HMR only uses text messages — no binary, fragmentation, or extensions. */

const WS_OPCODE_TEXT = 0x1;
const WS_OPCODE_CLOSE = 0x8;
const WS_OPCODE_PING = 0x9;
const WS_OPCODE_PONG = 0xa;

const parseWsFrame = (buf: Buffer) => {
	if (buf.length < 2) return null;

	const byte0 = buf[0]!;
	const byte1 = buf[1]!;
	const opcode = byte0 & 0x0f;
	const masked = (byte1 & 0x80) !== 0;
	let payloadLen = byte1 & 0x7f;
	let offset = 2;

	if (payloadLen === 126) {
		if (buf.length < 4) return null;
		payloadLen = buf.readUInt16BE(2);
		offset = 4;
	} else if (payloadLen === 127) {
		if (buf.length < 10) return null;
		payloadLen = Number(buf.readBigUInt64BE(2));
		offset = 10;
	}

	if (masked) {
		if (buf.length < offset + 4 + payloadLen) return null;
		const maskKey = buf.subarray(offset, offset + 4);
		offset += 4;
		const payload = Buffer.allocUnsafe(payloadLen);
		for (let i = 0; i < payloadLen; i++) {
			payload[i] = buf[offset + i]! ^ maskKey[i & 3]!;
		}
		return { opcode, payload, totalLen: offset + payloadLen };
	}

	if (buf.length < offset + payloadLen) return null;
	return {
		opcode,
		payload: buf.subarray(offset, offset + payloadLen),
		totalLen: offset + payloadLen
	};
};

const writeWsFrame = (opcode: number, payload: Buffer) => {
	const len = payload.length;
	let header: Buffer;
	if (len < 126) {
		header = Buffer.allocUnsafe(2);
		header[0] = 0x80 | opcode;
		header[1] = len;
	} else if (len < 65536) {
		header = Buffer.allocUnsafe(4);
		header[0] = 0x80 | opcode;
		header[1] = 126;
		header.writeUInt16BE(len, 2);
	} else {
		header = Buffer.allocUnsafe(10);
		header[0] = 0x80 | opcode;
		header[1] = 127;
		header.writeBigUInt64BE(BigInt(len), 2);
	}
	return Buffer.concat([header, payload]);
};

type Http2WebSocket = HMRWebSocket & {
	onMessage: ((data: string) => void) | null;
	onClose: (() => void) | null;
};

/* Wraps an h2 stream carrying WebSocket frames into an HMRWebSocket. */
const createHttp2WebSocket = (stream: ServerHttp2Stream): Http2WebSocket => {
	let state = WS_READY_STATE_OPEN;
	let buffer = Buffer.alloc(0);
	let onMessage: ((data: string) => void) | null = null;
	let onClose: (() => void) | null = null;

	stream.on('data', (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);

		while (buffer.length > 0) {
			const frame = parseWsFrame(buffer);
			if (!frame) break;

			buffer = buffer.subarray(frame.totalLen);

			if (frame.opcode === WS_OPCODE_TEXT && onMessage) {
				onMessage(frame.payload.toString('utf-8'));
			} else if (frame.opcode === WS_OPCODE_PING) {
				if (!stream.destroyed) {
					stream.write(writeWsFrame(WS_OPCODE_PONG, frame.payload));
				}
			} else if (frame.opcode === WS_OPCODE_CLOSE) {
				if (!stream.destroyed) {
					stream.write(
						writeWsFrame(WS_OPCODE_CLOSE, Buffer.alloc(0))
					);
					stream.end();
				}
				state = 3;
				if (onClose) onClose();
			}
		}
	});

	stream.on('close', () => {
		if (state === WS_READY_STATE_OPEN) {
			state = 3;
			if (onClose) onClose();
		}
	});

	stream.on('error', () => {
		state = 3;
	});

	const ws: Http2WebSocket = {
		get readyState() {
			return state;
		},
		send(data: string) {
			if (state !== WS_READY_STATE_OPEN || stream.destroyed) return;
			stream.write(writeWsFrame(WS_OPCODE_TEXT, Buffer.from(data)));
		},
		close() {
			if (state !== WS_READY_STATE_OPEN || stream.destroyed) return;
			stream.write(writeWsFrame(WS_OPCODE_CLOSE, Buffer.alloc(0)));
			stream.end();
			state = 2;
		},
		onMessage: null,
		onClose: null
	};

	// Wire up callbacks after creation
	onMessage = (data) => ws.onMessage?.(data);
	onClose = () => ws.onClose?.();

	return ws;
};

export const bridgeHttp2Stream = async (
	stream: ServerHttp2Stream,
	headers: IncomingHttpHeaders,
	fetchHandler: (request: Request) => Promise<Response> | Response,
	hmrState?: HMRState,
	manifest?: Record<string, string>
) => {
	const method = (headers[':method'] ?? 'GET') as string;
	const path = headers[':path'] ?? '/';

	// RFC 8441: Extended CONNECT for WebSocket over HTTP/2
	if (
		method === 'CONNECT' &&
		headers[':protocol'] === 'websocket' &&
		hmrState &&
		manifest
	) {
		stream.respond({ ':status': 200 });

		const ws = createHttp2WebSocket(stream);
		ws.onMessage = (data) => handleHMRMessage(hmrState, ws, data);
		ws.onClose = () => handleClientDisconnect(hmrState, ws);
		handleClientConnect(hmrState, ws, manifest);
		return;
	}

	const authority = headers[':authority'] ?? 'localhost';
	const scheme = headers[':scheme'] ?? 'https';
	const url = `${scheme}://${authority}${path}`;

	const requestHeaders = new Headers();
	for (const [key, value] of Object.entries(headers)) {
		if (key.startsWith(':') || value === undefined) continue;
		const headerValue = Array.isArray(value) ? value.join(', ') : value;
		requestHeaders.set(key, headerValue);
	}

	const hasBody = method !== 'GET' && method !== 'HEAD';
	const bodyBlob = hasBody
		? await new Promise<Blob>((resolve) => {
				const chunks: Buffer[] = [];
				stream.on('data', (chunk: Buffer) => chunks.push(chunk));
				stream.on('end', () => {
					resolve(new Blob([Buffer.concat(chunks)]));
				});
			})
		: null;

	const request = new Request(url, {
		body: bodyBlob,
		headers: requestHeaders,
		method
	});

	try {
		const response = await fetchHandler(request);

		const responseHeaders: Record<string, string | number> = {
			':status': response.status
		};
		response.headers.forEach((value, key) => {
			responseHeaders[key] = value;
		});

		if (!response.body) {
			stream.respond(responseHeaders);
			stream.end();
			return;
		}

		const arrayBuffer = await response.arrayBuffer();
		stream.respond(responseHeaders);
		stream.end(Buffer.from(arrayBuffer));
	} catch {
		stream.respond({ ':status': 500, 'content-type': 'text/plain' });
		stream.end('Internal Server Error');
	}
};
