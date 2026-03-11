import type { HMRState } from './clientManager';
import { serializeModuleVersions } from './moduleVersionTracker';
import type { HMRWebSocket } from '../../types/websocket';
import { WS_READY_STATE_OPEN } from '../../types/websocket';
import type { HMRClientMessage } from '../../types/messages';
import { isValidHMRClientMessage } from '../../types/messages';
import {
	PENDING_UPDATE_MAX_AGE_MS,
	PENDING_UPDATE_MAX_COUNT
} from '../constants';

const trySendMessage = (client: HMRWebSocket, messageStr: string) => {
	try {
		client.send(messageStr);

		return true;
	} catch {
		return false;
	}
};

const pruneExpiredUpdates = (state: HMRState) => {
	const cutoff = Date.now() - PENDING_UPDATE_MAX_AGE_MS;
	let first = state.pendingUpdates[0];
	while (first && first.timestamp < cutoff) {
		state.pendingUpdates.shift();
		first = state.pendingUpdates[0];
	}
};

export const broadcastToClients = (
	state: HMRState,
	message: { type: string; [key: string]: any }
) => {
	const timestamp = Date.now();
	const messageStr = JSON.stringify({
		...message,
		timestamp
	});

	/* Buffer the broadcast so reconnecting clients can replay missed updates */
	pruneExpiredUpdates(state);
	state.pendingUpdates.push({ message: messageStr, timestamp });
	if (state.pendingUpdates.length > PENDING_UPDATE_MAX_COUNT) {
		state.pendingUpdates.shift();
	}

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

	/* Replay any buffered updates the client may have missed during reconnection */
	replayPendingUpdates(state, client);
};

const replayPendingUpdates = (state: HMRState, client: HMRWebSocket) => {
	pruneExpiredUpdates(state);
	for (const pending of state.pendingUpdates) {
		trySendMessage(client, pending.message);
	}
	/* Clear pending updates after replay — the client is now caught up */
	state.pendingUpdates.length = 0;
};
export const handleClientDisconnect = (
	state: HMRState,
	client: HMRWebSocket
) => {
	state.connectedClients.delete(client);
};

const parseMessage = (message: unknown) => {
	if (typeof message === 'string') {
		return JSON.parse(message) as unknown;
	}

	if (message instanceof Buffer) {
		return JSON.parse(message.toString()) as unknown;
	}

	if (message instanceof ArrayBuffer) {
		return JSON.parse(
			new TextDecoder().decode(new Uint8Array(message))
		) as unknown;
	}

	if (ArrayBuffer.isView(message)) {
		return JSON.parse(
			new TextDecoder().decode(message as Uint8Array)
		) as unknown;
	}

	if (typeof message === 'object' && message !== null) {
		return message;
	}

	return null;
};

const handleParsedMessage = (client: HMRWebSocket, data: HMRClientMessage) => {
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
			break;
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

		handleParsedMessage(client, parsedData);
	} catch {}
};
