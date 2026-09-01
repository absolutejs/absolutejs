export const ABSOLUTE_EXPO_BRIDGE_FORMAT = 3 as const;
export const ABSOLUTE_EXPO_BRIDGE_MAX_BYTES = 64 * 1024;

export const ABSOLUTE_EXPO_BRIDGE_METHODS = [
	'devices.platform.getInfo',
	'devices.lifecycle.getState',
	'devices.links.getLaunchUrl',
	'devices.links.openExternal',
	'devices.network.getStatus',
	'devices.storage.clear',
	'devices.storage.get',
	'devices.storage.keys',
	'devices.storage.remove',
	'devices.storage.set',
	'devices.back.capability',
	'devices.clipboard.capability',
	'devices.clipboard.readText',
	'devices.clipboard.writeText',
	'devices.share.capability',
	'devices.share.share',
	'devices.haptics.capability',
	'devices.haptics.impact',
	'devices.haptics.notification',
	'devices.haptics.selectionChanged',
	'devices.haptics.vibrate',
	'devices.keyboard.capability',
	'devices.keyboard.dismiss',
	'devices.keyboard.getState',
	'devices.systemBars.capability',
	'devices.systemBars.setAppearance',
	'devices.systemBars.setVisible',
	'devices.camera.capability',
	'devices.camera.queryPermission',
	'devices.camera.requestPermission',
	'devices.camera.takePhoto',
	'devices.photos.capability',
	'devices.photos.pick',
	'devices.location.capability',
	'devices.location.current',
	'devices.location.queryPermission',
	'devices.location.requestPermission',
	'devices.location.watch.start',
	'devices.location.watch.stop',
	'devices.localNotifications.capability',
	'devices.localNotifications.queryPermission',
	'devices.localNotifications.requestPermission',
	'devices.localNotifications.schedule',
	'devices.localNotifications.pending',
	'devices.localNotifications.cancel',
	'devices.pushNotifications.capability',
	'devices.pushNotifications.queryPermission',
	'devices.pushNotifications.requestPermission',
	'devices.pushNotifications.enable',
	'devices.pushNotifications.disable',
	'devices.documents.capability',
	'devices.documents.pick',
	'devices.transfer.read',
	'devices.transfer.close',
	'devices.upload.begin',
	'devices.upload.write',
	'devices.documents.export',
	'devices.documents.open',
	'http.fetch',
	'auth.signIn',
	'auth.signOut',
	'auth.status',
	'sync.store.begin',
	'sync.store.deleteNamespace',
	'sync.store.end',
	'sync.store.schema',
	'sync.tx.deleteCollection',
	'sync.tx.deleteMutation',
	'sync.tx.getCollection',
	'sync.tx.getInstallationId',
	'sync.tx.getMutation',
	'sync.tx.listCollections',
	'sync.tx.listMutations',
	'sync.tx.putCollection',
	'sync.tx.putMutation',
	'sync.tx.setInstallationId',
	'sync.socket.close',
	'sync.socket.open',
	'sync.socket.sendChunk'
] as const;

export type AbsoluteExpoBridgeMethod =
	(typeof ABSOLUTE_EXPO_BRIDGE_METHODS)[number];

export type AbsoluteExpoBridgeRequest = {
	format: typeof ABSOLUTE_EXPO_BRIDGE_FORMAT;
	id: string;
	kind: 'request';
	method: AbsoluteExpoBridgeMethod;
	params: Record<string, unknown>;
	path: string;
};

export type AbsoluteExpoBridgeResponse = {
	format: typeof ABSOLUTE_EXPO_BRIDGE_FORMAT;
	id: string;
	kind: 'response';
	result?: unknown;
	error?: { code: string; message: string };
};

export type AbsoluteExpoBridgeEvent = {
	format: typeof ABSOLUTE_EXPO_BRIDGE_FORMAT;
	kind: 'event';
	event:
		| 'ready'
		| 'navigation'
		| 'auth.principal'
		| 'sync.socket'
		| 'sync.wake';
	path: string;
	payload?: Record<string, unknown>;
};

export type AbsoluteExpoBridgeMessage =
	| AbsoluteExpoBridgeEvent
	| AbsoluteExpoBridgeRequest
	| AbsoluteExpoBridgeResponse;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' &&
	value !== null &&
	!Array.isArray(value) &&
	(Object.getPrototypeOf(value) === Object.prototype ||
		Object.getPrototypeOf(value) === null);

const validId = (value: unknown) =>
	typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(value);

const validPath = (value: unknown) =>
	typeof value === 'string' &&
	value.startsWith('/') &&
	!value.startsWith('//') &&
	value.length <= 4096;

const parseRequest = (value: Record<string, unknown>) => {
	if (typeof value.id !== 'string' || !validId(value.id))
		throw new TypeError('Expo bridge request id is invalid.');
	const method = ABSOLUTE_EXPO_BRIDGE_METHODS.find(
		(candidate) => candidate === value.method
	);
	if (!method) {
		throw new TypeError('Expo bridge method is not allowed.');
	}
	if (!isRecord(value.params))
		throw new TypeError('Expo bridge request params must be an object.');
	if (typeof value.path !== 'string' || !validPath(value.path))
		throw new TypeError('Expo bridge request path is invalid.');
	if (method === 'devices.haptics.impact') {
		const styles = new Set([
			'error',
			'heavy',
			'light',
			'medium',
			'selection',
			'success',
			'vibrate',
			'warning'
		]);
		if (
			typeof value.params.style !== 'string' ||
			!styles.has(value.params.style)
		)
			throw new TypeError('Expo bridge haptics style is invalid.');
		if (
			value.params.durationMs !== undefined &&
			(typeof value.params.durationMs !== 'number' ||
				!Number.isFinite(value.params.durationMs) ||
				value.params.durationMs < 0 ||
				value.params.durationMs > 10_000)
		) {
			throw new TypeError('Expo bridge haptics duration is invalid.');
		}
	}
	if (method === 'http.fetch') {
		if (typeof value.params.url !== 'string')
			throw new TypeError('Expo bridge HTTP URL is invalid.');
		const url = new URL(value.params.url);
		const loopbackHttp =
			url.protocol === 'http:' &&
			(url.hostname === 'localhost' ||
				url.hostname === '127.0.0.1' ||
				url.hostname === '[::1]');
		if (url.protocol !== 'https:' && !loopbackHttp)
			throw new TypeError('Expo bridge HTTP URL must use HTTPS.');
		if (
			typeof value.params.method !== 'string' ||
			!['DELETE', 'GET', 'PATCH', 'POST', 'PUT'].includes(
				value.params.method
			)
		)
			throw new TypeError('Expo bridge HTTP method is not allowed.');
		if (
			value.params.body !== undefined &&
			typeof value.params.body !== 'string'
		)
			throw new TypeError('Expo bridge HTTP body is invalid.');
		if (
			typeof value.params.body === 'string' &&
			new TextEncoder().encode(value.params.body).byteLength > 48 * 1024
		)
			throw new TypeError('Expo bridge HTTP body exceeds 48 KiB.');
		if (
			(value.params.method === 'GET' ||
				value.params.method === 'DELETE') &&
			value.params.body !== undefined
		)
			throw new TypeError(
				'Expo bridge HTTP method cannot contain a body.'
			);
		if (!isRecord(value.params.headers))
			throw new TypeError('Expo bridge HTTP headers must be an object.');
		const headersAllowed = Object.entries(value.params.headers).every(
			([name, header]) =>
				typeof header === 'string' &&
				(name.toLowerCase() === 'accept' ||
					name.toLowerCase() === 'content-type' ||
					name.toLowerCase().startsWith('x-absolute-mobile-'))
		);
		if (!headersAllowed) {
			throw new TypeError('Expo bridge HTTP header is not allowed.');
		}
	}
	if (method === 'auth.signIn') {
		if (
			typeof value.params.email !== 'string' ||
			value.params.email.length > 320 ||
			typeof value.params.signup !== 'boolean'
		)
			throw new TypeError('Expo bridge Auth sign-in params are invalid.');
	}
	if (
		(method === 'auth.signOut' || method === 'auth.status') &&
		Object.keys(value.params).length !== 0
	)
		throw new TypeError('Expo bridge Auth params must be empty.');

	return {
		format: ABSOLUTE_EXPO_BRIDGE_FORMAT,
		id: value.id,
		kind: 'request' as const,
		method,
		params: value.params,
		path: value.path
	};
};

const parseResponse = (value: Record<string, unknown>) => {
	if (typeof value.id !== 'string' || !validId(value.id))
		throw new TypeError('Expo bridge response id is invalid.');
	if (value.error !== undefined) {
		if (
			!isRecord(value.error) ||
			typeof value.error.code !== 'string' ||
			typeof value.error.message !== 'string'
		) {
			throw new TypeError('Expo bridge response error is invalid.');
		}
		if (value.result !== undefined)
			throw new TypeError(
				'Expo bridge response cannot contain result and error.'
			);
	}

	if (isRecord(value.error)) {
		return {
			error: {
				code: String(value.error.code),
				message: String(value.error.message)
			},
			format: ABSOLUTE_EXPO_BRIDGE_FORMAT,
			id: value.id,
			kind: 'response' as const
		};
	}

	return {
		format: ABSOLUTE_EXPO_BRIDGE_FORMAT,
		id: value.id,
		kind: 'response' as const,
		result: value.result
	};
};

const parseEvent = (value: Record<string, unknown>) => {
	if (
		value.event !== 'ready' &&
		value.event !== 'navigation' &&
		value.event !== 'auth.principal' &&
		value.event !== 'sync.socket' &&
		value.event !== 'sync.wake'
	) {
		throw new TypeError('Expo bridge event is not allowed.');
	}
	if (typeof value.path !== 'string' || !validPath(value.path))
		throw new TypeError('Expo bridge event path is invalid.');
	if (value.payload !== undefined && !isRecord(value.payload)) {
		throw new TypeError('Expo bridge event payload must be an object.');
	}

	return {
		event: value.event,
		format: ABSOLUTE_EXPO_BRIDGE_FORMAT,
		kind: 'event' as const,
		path: value.path,
		...(value.payload ? { payload: value.payload } : {})
	};
};

export const createAbsoluteExpoBridgeError = (
	id: string,
	code: string,
	message: string
) =>
	parseResponse({
		error: { code, message },
		format: ABSOLUTE_EXPO_BRIDGE_FORMAT,
		id,
		kind: 'response'
	});
export const createAbsoluteExpoBridgeResponse = (id: string, result: unknown) =>
	parseResponse({
		format: ABSOLUTE_EXPO_BRIDGE_FORMAT,
		id,
		kind: 'response',
		result
	});
export const parseAbsoluteExpoBridgeMessage = (source: string) => {
	if (
		new TextEncoder().encode(source).byteLength >
		ABSOLUTE_EXPO_BRIDGE_MAX_BYTES
	)
		throw new TypeError('Expo bridge message exceeds 64 KiB.');
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch (cause) {
		throw new TypeError('Expo bridge message is not valid JSON.', {
			cause
		});
	}
	if (!isRecord(parsed) || parsed.format !== ABSOLUTE_EXPO_BRIDGE_FORMAT) {
		throw new TypeError('Expo bridge message format is unsupported.');
	}
	if (parsed.kind === 'request') return parseRequest(parsed);
	if (parsed.kind === 'response') return parseResponse(parsed);
	if (parsed.kind === 'event') return parseEvent(parsed);

	throw new TypeError('Expo bridge message kind is unsupported.');
};
