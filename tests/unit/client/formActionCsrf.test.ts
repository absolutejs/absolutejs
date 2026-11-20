import { afterEach, describe, expect, test } from 'bun:test';
import {
	enhanceHtmxCsrf,
	submitFormAction
} from '../../../src/client/formActions';
import {
	registerCsrfTokenGetter,
	CSRF_HEADER_NAME
} from '../../../src/utils/csrfTokenRef';

const GETTER_KEY = Symbol.for('absolutejs.csrfTokenGetter');
const originalFetch = globalThis.fetch;

type Captured = { headers: Headers | undefined };

const captured: Captured = { headers: undefined };

/* `preconnect` is carried over so the stub still satisfies `typeof fetch`
 * without an assertion. */
const captureRequests = () => {
	const stub = (_input: unknown, init?: RequestInit) => {
		captured.headers = new Headers(init?.headers);

		return Promise.resolve(
			new Response(JSON.stringify({ status: 'success' }), {
				headers: { 'content-type': 'application/json' }
			})
		);
	};
	globalThis.fetch = Object.assign(stub, {
		preconnect: originalFetch.preconnect
	});
};

afterEach(() => {
	globalThis.fetch = originalFetch;
	captured.headers = undefined;
	Reflect.deleteProperty(globalThis, GETTER_KEY);
});

describe('submitFormAction and the CSRF token', () => {
	test('sends the token header when one is readable', async () => {
		captureRequests();
		registerCsrfTokenGetter(() => 'value.signature');
		await submitFormAction('/members', new FormData());
		expect(captured.headers?.get(CSRF_HEADER_NAME)).toBe('value.signature');
	});

	test('sends no token header when there is none', async () => {
		captureRequests();
		await submitFormAction('/members', new FormData());
		expect(captured.headers?.has(CSRF_HEADER_NAME)).toBe(false);
		// The submission still identifies itself as a form action.
		expect(captured.headers?.get('x-absolute-action')).toBe('1');
	});
});

describe('enhanceHtmxCsrf', () => {
	/* A listener registry rather than a real EventTarget: another test file
	 * in this process installs a DOM library, so a CustomEvent built here
	 * is not an instance of the Event class Bun's EventTarget checks for,
	 * and dispatchEvent rejects it. Calling the listener directly tests the
	 * same code without that cross-realm accident. */
	const fakeTarget = () => {
		const listeners = new Set<EventListener>();
		const target: EventTarget = {
			addEventListener: (
				_type: string,
				listener: EventListenerOrEventListenerObject | null
			) => {
				if (typeof listener === 'function') listeners.add(listener);
			},
			dispatchEvent: () => true,
			removeEventListener: (
				_type: string,
				listener: EventListenerOrEventListenerObject | null
			) => {
				if (typeof listener === 'function') listeners.delete(listener);
			}
		};

		return {
			target,
			fire: (detail: unknown) =>
				listeners.forEach((listener) =>
					listener(new CustomEvent('htmx:configRequest', { detail }))
				)
		};
	};

	test('adds the header to an HTMX request', () => {
		registerCsrfTokenGetter(() => 'value.signature');
		const { fire, target } = fakeTarget();
		const remove = enhanceHtmxCsrf(target);
		const headers: Record<string, string> = {};
		fire({ headers });
		remove();
		expect(headers).toEqual({ [CSRF_HEADER_NAME]: 'value.signature' });
	});

	test('stops once removed, and tolerates an event without headers', () => {
		registerCsrfTokenGetter(() => 'value.signature');
		const { fire, target } = fakeTarget();
		const remove = enhanceHtmxCsrf(target);
		expect(() => fire({ parameters: {} })).not.toThrow();
		remove();
		const headers: Record<string, string> = {};
		fire({ headers });
		expect(headers).toEqual({});
	});
});
