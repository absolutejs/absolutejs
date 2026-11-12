import { nonceAttr } from '../utils/cspNonceRef';
import type { ServerDataCollector } from '../../types/vue';
import { escapeScriptContent } from '../utils/escapeScriptContent';
import { isProductionRuntime } from '../utils/runtimeMode';

/** Property on the Vue `SSRContext` that carries the request's collector.
 *  A plain string (not a symbol) so it survives a page bundle that ends up
 *  with its own copy of this module. */
export const SERVER_DATA_CONTEXT_KEY = '__absoluteServerData';

/** Browser global the page payload is assigned to; the browser build of
 *  `useServerData` reads `window.__ABSOLUTE_SERVER_DATA__`. This module must
 *  not import `vue`: the page handler loads it, and apps without Vue
 *  installed still bundle the handler. */
const SERVER_DATA_GLOBAL = '__ABSOLUTE_SERVER_DATA__';

const GENERIC_ERROR_MESSAGE = 'Loading server data failed.';

/** The error as the browser will see it. The server renders this same
 *  error, so a production page whose message was replaced still hydrates
 *  without a text mismatch. */
const toPublicError = (cause: unknown) => {
	const detail = cause instanceof Error ? cause.message : String(cause);
	const publicError = new Error(
		isProductionRuntime() ? GENERIC_ERROR_MESSAGE : detail
	);
	publicError.name = cause instanceof Error ? cause.name : 'Error';

	return publicError;
};

/** Reserves `key` for this request and returns whether the caller owns it.
 *  Two components using one key would overwrite each other's payload and
 *  hydrate from the wrong value, so a repeated key is refused. Outside
 *  production the collector records an error that fails the page once
 *  rendering ends (throwing from `setup()` would leave Vue's SSR state
 *  half-reset); in production a warning is logged and the repeated call
 *  loads in the browser. */
export const claimServerDataKey = (
	collector: ServerDataCollector,
	key: string
) => {
	if (!collector.claimed.has(key)) {
		collector.claimed.add(key);

		return true;
	}
	const message = `useServerData: the key "${key}" is used more than once while rendering this page. Each useServerData() call in one request needs its own key — include the component's identity (for example an id or route param) in the key.`;
	if (isProductionRuntime()) {
		console.warn(`${message} The repeated call will load in the browser.`);
	} else {
		collector.failure ??= new Error(message);
	}

	return false;
};

export const createServerDataCollector = () => {
	const collector: ServerDataCollector = {
		claimed: new Set(),
		failure: null,
		json: new Map()
	};

	return collector;
};

export const isServerDataCollector = (
	value: unknown
): value is ServerDataCollector =>
	typeof value === 'object' &&
	value !== null &&
	'claimed' in value &&
	value.claimed instanceof Set &&
	'failure' in value &&
	(value.failure === null || value.failure instanceof Error) &&
	'json' in value &&
	value.json instanceof Map;

/** The inline script that hands `useServerData` results to the browser, or
 *  an empty string when the page loaded none. Every inline script for this
 *  payload is written here, so attributes such as a CSP nonce belong in
 *  this one place. The JSON is escaped so no value can close the script
 *  element or break the JavaScript around it. */
export const serializeServerDataScript = (
	collector: ServerDataCollector | null
) => {
	if (!collector || collector.json.size === 0) return '';
	const members = [...collector.json].map(
		([key, json]) => `${JSON.stringify(key)}:${json}`
	);

	return `<script${nonceAttr()}>window.${SERVER_DATA_GLOBAL}=${escapeScriptContent(`{${members.join(',')}}`)}</script>`;
};

/** Records a failed load and returns the error to render with: the one the
 *  browser receives, with its message replaced in production. */
export const storeServerDataError = (
	collector: ServerDataCollector,
	key: string,
	cause: unknown
) => {
	console.error(`[SSR] useServerData("${key}") failed:`, cause);
	const publicError = toPublicError(cause);
	const { message, name } = publicError;
	collector.json.set(key, JSON.stringify({ error: { message, name } }));

	return publicError;
};

/** Serializes the value now so an unserializable result (a cycle, a
 *  BigInt) becomes this key's error state instead of breaking the page.
 *  Returns the error when serialization failed. */
export const storeServerDataValue = (
	collector: ServerDataCollector,
	key: string,
	value: unknown
) => {
	try {
		collector.json.set(key, `{"data":${JSON.stringify(value) ?? 'null'}}`);

		return null;
	} catch (cause) {
		const reason = cause instanceof Error ? cause.message : String(cause);
		const failure = new Error(
			`useServerData: the value for "${key}" cannot be serialized to JSON (${reason}).`
		);

		return storeServerDataError(collector, key, failure);
	}
};

/** Throws the error a render recorded (a repeated key in development), so
 *  the page handler fails the response instead of serving a page whose
 *  payload is ambiguous. */
export const throwServerDataFailure = (collector: ServerDataCollector) => {
	if (collector.failure) throw collector.failure;
};
