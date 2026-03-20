import type { HMRState } from './clientManager';
import { serializeModuleVersions } from './moduleVersionTracker';
import { type HMRWebSocket, WS_READY_STATE_OPEN } from '../../types/websocket';
import type { HMRClientMessage } from '../../types/messages';
import { isValidHMRClientMessage } from '../../types/typeGuards';
import { logHmrUpdate } from '../utils/logger';

const trySendMessage = (client: HMRWebSocket, messageStr: string) => {
	try {
		client.send(messageStr);

		return true;
	} catch {
		return false;
	}
};

export const broadcastToClients = (
	state: HMRState,
	message: { type: string; [key: string]: unknown }
) => {
	const messageStr = JSON.stringify({
		...message,
		timestamp: Date.now()
	});

	const shouldRemove = (client: HMRWebSocket) => {
		if (client.readyState !== WS_READY_STATE_OPEN) return true;

		return !trySendMessage(client, messageStr);
	};

	const clientsToRemove: HMRWebSocket[] = [];
	state.connectedClients.forEach((client) => {
		if (shouldRemove(client)) clientsToRemove.push(client);
	});

	clientsToRemove.forEach((client) => {
		state.connectedClients.delete(client);
	});
};
export const handleClientConnect = (
	state: HMRState,
	client: HMRWebSocket,
	manifest: Record<string, string>
) => {
	state.connectedClients.add(client);

	const serverVersions = serializeModuleVersions(state.moduleVersions);
	client.send(
		JSON.stringify({
			data: {
				manifest,
				serverVersions
			},
			timestamp: Date.now(),
			type: 'manifest'
		})
	);

	client.send(
		JSON.stringify({
			message: 'HMR client connected successfully',
			timestamp: Date.now(),
			type: 'connected'
		})
	);
};
export const handleClientDisconnect = (
	state: HMRState,
	client: HMRWebSocket
) => {
	state.connectedClients.delete(client);
};

const parseJsonSafe = (raw: string) => JSON.parse(raw);

const parseMessage = (message: unknown) => {
	if (typeof message === 'string') {
		return parseJsonSafe(message);
	}

	if (message instanceof Buffer) {
		return parseJsonSafe(message.toString());
	}

	if (message instanceof ArrayBuffer) {
		return parseJsonSafe(new TextDecoder().decode(new Uint8Array(message)));
	}

	if (ArrayBuffer.isView(message)) {
		const view: Uint8Array = new Uint8Array(
			message.buffer,
			message.byteOffset,
			message.byteLength
		);

		return parseJsonSafe(new TextDecoder().decode(view));
	}

	if (typeof message === 'object' && message !== null) {
		return message;
	}

	return null;
};

const handleParsedMessage = (
	state: HMRState,
	client: HMRWebSocket,
	data: HMRClientMessage
) => {
	switch (data.type) {
		case 'ping':
			client.send(
				JSON.stringify({
					timestamp: Date.now(),
					type: 'pong'
				})
			);
			break;

		case 'request-rebuild':
			break;

		case 'ready':
			if (data.framework) {
				state.activeFrameworks.add(data.framework);
			}
			break;

		case 'hmr-timing': {
			const timing = data as { duration?: number };
			if (timing.duration !== undefined) {
				logHmrUpdate(
					state.lastHmrPath ?? '',
					state.lastHmrFramework,
					timing.duration
				);
			}
			break;
		}
	}
};

export const handleHMRMessage = (
	state: HMRState,
	client: HMRWebSocket,
	message: unknown
) => {
	try {
		const parsedData = parseMessage(message);
		if (parsedData === null) {
			return;
		}

		if (!isValidHMRClientMessage(parsedData)) {
			return;
		}

		handleParsedMessage(state, client, parsedData);
	} catch {
		/* ignored */
	}
};
