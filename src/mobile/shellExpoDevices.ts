import { createWebDeviceAdapter } from '@absolutejs/devices/web';
import { installDeviceAdapter } from '@absolutejs/devices/runtime';

type ExpoFetchResult = {
	body: string;
	headers: Record<string, string>;
	status: number;
};

const bridge = () => {
	const value: unknown = Reflect.get(globalThis, '__absoluteExpoBridge');
	if (
		typeof value !== 'object' ||
		value === null ||
		typeof Reflect.get(value, 'request') !== 'function'
	) {
		return undefined;
	}

	return {
		request: (method: string, params: Record<string, unknown>) =>
			Promise.resolve(
				Reflect.apply(Reflect.get(value, 'request'), value, [
					method,
					params
				])
			)
	};
};

const parseFetchResult = (value: unknown): ExpoFetchResult => {
	if (!value || typeof value !== 'object')
		throw new TypeError(
			'The Expo HTTP bridge returned an invalid response.'
		);
	const body = Reflect.get(value, 'body');
	const headers = Reflect.get(value, 'headers');
	const status = Reflect.get(value, 'status');
	if (
		typeof body !== 'string' ||
		typeof status !== 'number' ||
		!Number.isInteger(status) ||
		!headers ||
		typeof headers !== 'object'
	) {
		throw new TypeError(
			'The Expo HTTP bridge returned an invalid response.'
		);
	}
	const entries = Object.entries(headers);
	if (!entries.every(([, header]) => typeof header === 'string')) {
		throw new TypeError('The Expo HTTP bridge returned invalid headers.');
	}

	return {
		body,
		headers: Object.fromEntries(
			entries.map(([name, header]) => [name, String(header)])
		),
		status
	};
};

const requireBridge = () => {
	const provider = bridge();
	if (!provider)
		throw new TypeError('The Expo WebView bridge is unavailable.');

	return provider;
};

/** Installs only capabilities implemented by the versioned Expo WebView bridge. */
export const createAbsoluteExpoBridgeFetch =
	() => async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		if (request.method !== 'GET') {
			throw new TypeError(
				'The experimental Expo envelope bridge currently supports GET only.'
			);
		}
		const headers = Object.fromEntries(request.headers);
		const result = parseFetchResult(
			await requireBridge().request('http.fetch', {
				headers,
				method: request.method,
				url: request.url
			})
		);

		return new Response(result.body, {
			headers: result.headers,
			status: result.status
		});
	};
export const installAbsoluteExpoWebDeviceAdapter = () => {
	const web = createWebDeviceAdapter();

	return installDeviceAdapter({
		...web,
		haptics: {
			capability: async () =>
				bridge()
					? ({
							available: true,
							fidelity: 'native',
							native: true
						} as const)
					: ({
							available: false,
							message: 'The Expo WebView bridge is unavailable.',
							reason: 'unavailable'
						} as const),
			impact: async (style) => {
				await requireBridge().request('devices.haptics.impact', {
					style
				});
			},
			notification: async (style) => {
				await requireBridge().request('devices.haptics.impact', {
					style
				});
			},
			selectionChanged: async () => {
				await requireBridge().request('devices.haptics.impact', {
					style: 'selection'
				});
			},
			vibrate: async (durationMs) => {
				await requireBridge().request('devices.haptics.impact', {
					durationMs,
					style: 'vibrate'
				});
			}
		},
		runtime: 'expo'
	});
};
