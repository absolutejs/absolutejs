import { installExpoWebViewDeviceAdapter } from '@absolutejs/devices-expo/bridge';

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
		on: (
			event: string,
			listener: (payload: Record<string, unknown>) => void
		) => {
			const eventRegistrar: unknown = Reflect.get(value, 'on');
			if (typeof eventRegistrar !== 'function') return () => undefined;
			const subscription: unknown = Reflect.apply(eventRegistrar, value, [
				event,
				listener
			]);
			if (typeof subscription !== 'function') return () => undefined;

			return async () => {
				await Reflect.apply(subscription, undefined, []);
			};
		},
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

export const createAbsoluteExpoBridgeFetch =
	() => async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		const body =
			request.method === 'GET' || request.method === 'DELETE'
				? undefined
				: await request.text();
		const headers = Object.fromEntries(request.headers);
		const result = parseFetchResult(
			await requireBridge().request('http.fetch', {
				...(body === undefined ? {} : { body }),
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
/** Installs the provider-neutral adapter backed by the generated native host. */
export const installAbsoluteExpoWebDeviceAdapter = (
	capabilities: readonly string[] = []
) => installExpoWebViewDeviceAdapter(requireBridge(), capabilities);
