import type { HMRState } from './clientManager';
import { serializeModuleVersions } from './moduleVersionTracker';
import { type HMRWebSocket, WS_READY_STATE_OPEN } from '../../types/websocket';
import type { HMRClientMessage } from '../../types/messages';
import { isValidHMRClientMessage } from '../../types/typeGuards';
import { logHmrUpdate, logInfo } from '../utils/logger';

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

	const shouldRemove = (client: HMRWebSocket) =>
		// Note: Bun's WebSocket wrapper sometimes reports `readyState=3`
		// (CLOSED) for connections that are actually still alive on the
		// browser side — observed when sending consecutive broadcasts
		// inside a single tick. Try the send unconditionally; if the
		// underlying socket is genuinely closed, `client.send` throws
		// and we drop on the catch path.
		!trySendMessage(client, messageStr);
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

	/* If the most recent build degraded on an unresolvable reference (a bad
	 * CSS `@import`, a missing manifest key), the browser that just connected
	 * missed the live `rebuild-error` broadcast — replay it so the overlay
	 * names the offending file/reference instead of the page silently
	 * rendering without its stylesheet/bundle. */
	if (state.lastBuildErrors && state.lastBuildErrors.length > 0) {
		const [first] = state.lastBuildErrors;
		client.send(
			JSON.stringify({
				data: {
					column: first?.column,
					error: first?.message,
					file: first?.file,
					line: first?.line,
					passErrors: state.lastBuildErrors.map((passError) => ({
						file: passError.file,
						label: passError.label,
						line: passError.line,
						message: passError.message,
						specifier: passError.specifier
					}))
				},
				message: 'Build completed with unresolved references',
				timestamp: Date.now(),
				type: 'rebuild-error'
			})
		);
	}
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
		const view = new Uint8Array(
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

		case 'hmr-timing':
			logHmrUpdate(
				state.lastHmrPath ?? '',
				state.lastHmrFramework,
				data.duration
			);
			break;

		case 'angular:hmr-ack': {
			const tag = data.tier === 'tier-0' ? 'tier-0' : 'tier-1a';
			const suffix = data.error
				? ` FAILED — ${data.error}`
				: ` applied in ${data.applyMs.toFixed(0)}ms`;
			logInfo(`[ng-hmr] ${tag} ${data.className}${suffix}`);
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
