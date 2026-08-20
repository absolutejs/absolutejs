import type { HMRState } from './clientManager';
import { serializeModuleVersions } from './moduleVersionTracker';
import type { HMRWebSocket } from '../../types/websocket';
import type { HMRClientMessage } from '../../types/messages';
import { isValidHMRClientMessage } from '../../types/typeGuards';
import { sendTelemetryEvent } from '../cli/telemetryEvent';
import { logHmrClientUpdate, logInfo } from '../utils/logger';

const MAX_RETAINED_HMR_UPDATES = 100;

const normalizedHmrTarget = (value: unknown) => {
	if (value === 'capacitor-android') return value;
	if (value === 'capacitor-ios') return value;
	if (value === 'capacitor-native') return value;

	return 'web';
};

const hmrMessageMetadata = (
	state: HMRState,
	message: { type: string; [key: string]: unknown }
) => {
	const data = Reflect.get(message, 'data');
	const framework =
		typeof data === 'object' &&
		data !== null &&
		typeof Reflect.get(data, 'framework') === 'string'
			? String(Reflect.get(data, 'framework'))
			: state.lastHmrFramework;
	const source =
		typeof data === 'object' && data !== null
			? (Reflect.get(data, 'primarySource') ??
				Reflect.get(data, 'sourceFile'))
			: undefined;

	return {
		framework,
		path: typeof source === 'string' ? source : state.lastHmrPath
	};
};

const retainHmrUpdate = (
	state: HMRState,
	updateId: number,
	message: { type: string; [key: string]: unknown }
) => {
	const metadata = hmrMessageMetadata(state, message);
	if (!metadata.framework && !metadata.path) return;
	state.hmrUpdates.set(updateId, metadata);
	if (state.hmrUpdates.size <= MAX_RETAINED_HMR_UPDATES) return;
	const oldest = state.hmrUpdates.keys().next().value;
	if (typeof oldest === 'number') state.hmrUpdates.delete(oldest);
};

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
	const timestamp = Math.max(Date.now(), state.lastBroadcastTimestamp + 1);
	state.lastBroadcastTimestamp = timestamp;
	retainHmrUpdate(state, timestamp, message);
	const messageStr = JSON.stringify({
		...message,
		timestamp
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

		case 'hmr-timing': {
			const update =
				typeof data.updateId === 'number'
					? state.hmrUpdates.get(data.updateId)
					: undefined;
			logHmrClientUpdate(
				update?.path ?? state.lastHmrPath ?? '',
				update?.framework ?? state.lastHmrFramework,
				data.duration,
				normalizedHmrTarget(data.target),
				data.serverMs,
				data.clientMs
			);
			sendTelemetryEvent('hmr:client-applied', {
				clientMs: data.clientMs,
				durationMs: data.duration,
				framework:
					update?.framework ?? state.lastHmrFramework ?? 'unknown',
				serverMs: data.serverMs,
				target: normalizedHmrTarget(data.target)
			});
			break;
		}

		case 'angular:hmr-ack': {
			const tag = data.tier === 'tier-0' ? 'tier-0' : 'tier-1a';
			const suffix = data.error
				? ` FAILED — ${data.error}`
				: ` applied in ${data.applyMs.toFixed(0)}ms`;
			const target = normalizedHmrTarget(data.target);
			logInfo(`[ng-hmr:${target}] ${tag} ${data.className}${suffix}`);
			sendTelemetryEvent('hmr:client-applied', {
				clientMs: data.applyMs,
				durationMs: data.applyMs,
				framework: 'angular',
				success: data.error === undefined,
				target,
				tier: data.tier
			});
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
