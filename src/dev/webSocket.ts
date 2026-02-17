import type { HMRState } from './clientManager';
import { serializeModuleVersions } from './moduleVersionTracker';
import type { HMRWebSocket } from '../../types/websocket';
import { WS_READY_STATE_OPEN } from '../../types/websocket';
import type { HMRClientMessage } from '../../types/messages';
import { isValidHMRClientMessage } from '../../types/messages';

/* Magic pt. 2 - when a browser connects to our WebSocket
   We send them the current manifest so they know what files exist
   Like giving them a menu of all the dishes we can serve */
export const handleClientConnect = (
	state: HMRState,
	client: HMRWebSocket,
	manifest: Record<string, string>
) => {
	state.connectedClients.add(client);

	// Send them the current state of the menu (manifest) and module versions
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

	// And confirm they're connected
	client.send(
		JSON.stringify({
			message: 'HMR client connected successfully',
			timestamp: Date.now(),
			type: 'connected'
		})
	);
};

/* When a client disconnects, remove them from our tracking
   This prevents memory leaks and keeps our client list clean */
export const handleClientDisconnect = (
	state: HMRState,
	client: HMRWebSocket
) => {
	state.connectedClients.delete(client);
};

/* Handle messages from clients - they might ping us or request rebuilds
   We need to handle different message types because WebSocket is just a pipe/stream */
export const handleHMRMessage = (
	state: HMRState,
	client: HMRWebSocket,
	message: unknown
) => {
	try {
		/* WebSocket messages can come in different formats
       sometimes they're strings, sometimes they're Buffers, sometimes they're objects...
       we need to handle all of them because JavaScript is weird like that */
		let parsedData: unknown;

		if (typeof message === 'string') {
			parsedData = JSON.parse(message);
		} else if (message instanceof Buffer) {
			parsedData = JSON.parse(message.toString());
		} else if (message instanceof ArrayBuffer) {
			parsedData = JSON.parse(
				new TextDecoder().decode(new Uint8Array(message))
			);
		} else if (ArrayBuffer.isView(message)) {
			parsedData = JSON.parse(
				new TextDecoder().decode(message as Uint8Array)
			);
		} else if (typeof message === 'object' && message !== null) {
			// Message is already an object - no parsing needed
			parsedData = message;
		} else {
			return;
		}

		if (!isValidHMRClientMessage(parsedData)) {
			return;
		}

		const data: HMRClientMessage = parsedData;

		switch (data.type) {
			case 'ping':
				// Client is checking if we're alive - respond with pong
				client.send(
					JSON.stringify({
						timestamp: Date.now(),
						type: 'pong'
					})
				);
				break;

			case 'request-rebuild':
				// Note: triggerRebuild would be called from outside
				break;

			case 'ready':
				break;

			case 'hydration-error':
				break;
		}
	} catch {}
};

/* Send messages to all connected WebSocket clients
   this is how we notify browsers when files change */
export const broadcastToClients = (
	state: HMRState,
	message: { type: string; [key: string]: any }
) => {
	const messageStr = JSON.stringify({
		...message,
		timestamp: Date.now()
	});

	let sentCount = 0;
	const clientsToRemove: HMRWebSocket[] = [];

	for (const client of state.connectedClients) {
		if (client.readyState === WS_READY_STATE_OPEN) {
			try {
				client.send(messageStr);
				sentCount++;
			} catch {
				clientsToRemove.push(client);
			}
		} else {
			// Mark closed clients for removal
			clientsToRemove.push(client);
		}
	}

	// Remove closed/failed clients
	for (const client of clientsToRemove) {
		state.connectedClients.delete(client);
	}
};
