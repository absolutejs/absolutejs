import { afterEach, describe, expect, test } from 'bun:test';
import {
	assertNoServerSecrets,
	findServerSecret,
	resetServerSecretCache
} from '../../../src/utils/serverSecrets';
import { serializeInitialProps } from '../../../src/utils/initialProps';

/* Props are the one path that carries a server value into the browser
 * verbatim. Bun does not inline `process.env.X` into a client bundle — the
 * reference survives and throws there — so a naming convention on
 * references would not catch this. What travels is a value, so the guard
 * matches values. */

const SECRET = 'sk_live_51H8xqLexampleKEY';

const set = (name: string, value: string) => {
	process.env[name] = value;
	resetServerSecretCache();
};

const unset = (...names: string[]) => {
	names.forEach((name) => Reflect.deleteProperty(process.env, name));
	resetServerSecretCache();
};

afterEach(() =>
	unset(
		'STRIPE_SECRET_KEY',
		'SHORT_KEY',
		'PUBLIC_STRIPE_PUBLISHABLE_KEY',
		'STRIPE_PUBLISHABLE_KEY',
		'VAPID_PUBLIC_KEY',
		'NEXT_PUBLIC_MAPS_KEY',
		'CHECKOUT_KEY',
		'REPUBLICAN_TOKEN',
		'DATABASE_URL',
		'SESSION_TOKEN'
	)
);

describe('findServerSecret', () => {
	test('finds a sensitive value anywhere in the payload', () => {
		set('STRIPE_SECRET_KEY', SECRET);
		expect(findServerSecret(`{"a":{"b":["${SECRET}"]}}`)).toBe(
			'STRIPE_SECRET_KEY'
		);
		// Embedded in a longer string, which is how one arrives by
		// accident: a URL, a header, a log line passed as a prop.
		expect(
			findServerSecret(`{"url":"https://api.test?key=${SECRET}"}`)
		).toBe('STRIPE_SECRET_KEY');
	});

	test('ignores a payload that does not carry it', () => {
		set('STRIPE_SECRET_KEY', SECRET);
		expect(findServerSecret('{"name":"Ada"}')).toBeUndefined();
	});

	test('ignores a variable whose name does not read as sensitive', () => {
		// Otherwise a hostname or a connection string that legitimately
		// reaches a page would fail every render.
		set('DATABASE_URL', 'postgres://localhost:5432/app_development');
		expect(
			findServerSecret(
				'{"db":"postgres://localhost:5432/app_development"}'
			)
		).toBeUndefined();
	});

	test('ignores a short value, which would collide with real content', () => {
		set('SHORT_KEY', 'abc123');
		expect(findServerSecret('{"note":"abc123"}')).toBeUndefined();
	});

	test('a PUBLIC_ prefix says the value is meant to be sent', () => {
		// A publishable key reads as sensitive by name and is not.
		set('PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_live_51H8xqLexample');
		expect(
			findServerSecret('{"key":"pk_live_51H8xqLexample"}')
		).toBeUndefined();
	});

	test('a name that says public or publishable in its own words', () => {
		// Stripe's own name for the key every checkout page sends.
		set('STRIPE_PUBLISHABLE_KEY', 'pub_value_8a7b6c5d4e3f');
		set('VAPID_PUBLIC_KEY', 'BCvapid_public_9x8y7z');
		set('NEXT_PUBLIC_MAPS_KEY', 'maps_browser_7q6w5e4r');
		expect(
			findServerSecret(
				'{"a":"pub_value_8a7b6c5d4e3f","b":"BCvapid_public_9x8y7z","c":"maps_browser_7q6w5e4r"}'
			)
		).toBeUndefined();
	});

	test('a Stripe publishable value is public under any name', () => {
		set('CHECKOUT_KEY', 'pk_test_51H8xqLexample');
		expect(
			findServerSecret('{"k":"pk_test_51H8xqLexample"}')
		).toBeUndefined();
	});

	test('PUBLIC must be its own word in the name', () => {
		set('REPUBLICAN_TOKEN', 'tok_live_1a2b3c4d5e6f');
		expect(findServerSecret('{"t":"tok_live_1a2b3c4d5e6f"}')).toBe(
			'REPUBLICAN_TOKEN'
		);
	});

	test('catches any sensitive-looking name, not just KEY', () => {
		set('SESSION_TOKEN', 'tok_live_9f8e7d6c5b4a');
		expect(findServerSecret('{"t":"tok_live_9f8e7d6c5b4a"}')).toBe(
			'SESSION_TOKEN'
		);
	});
});

describe('assertNoServerSecrets', () => {
	test('names the variable and where, and never the value', () => {
		set('STRIPE_SECRET_KEY', SECRET);
		try {
			assertNoServerSecrets(`{"k":"${SECRET}"}`, 'The React page Home');
			throw new Error('should have thrown');
		} catch (error) {
			const message = error instanceof Error ? error.message : '';
			expect(message).toContain('STRIPE_SECRET_KEY');
			expect(message).toContain('The React page Home');
			// An error message is logged, and a log is not a place to put a
			// key that just escaped.
			expect(message).not.toContain(SECRET);
		}
	});
});

describe('serializeInitialProps', () => {
	test('returns the JSON a page hydrates from', () => {
		expect(serializeInitialProps({ name: 'Ada' }, 'A page')).toBe(
			'{"name":"Ada"}'
		);
		expect(serializeInitialProps(undefined, 'A page')).toBe('{}');
	});

	test('refuses props carrying a secret', () => {
		set('STRIPE_SECRET_KEY', SECRET);
		expect(() =>
			serializeInitialProps({ apiKey: SECRET }, 'The Vue page Checkout')
		).toThrow(/STRIPE_SECRET_KEY/);
	});
});

/* Each framework serializes its own props, so each has to be wired. These
 * go through the real handlers: a guard that only one framework calls is
 * the failure this file is here to prevent. */
describe('the page handlers refuse it', () => {
	test('a Vue page', async () => {
		set('STRIPE_SECRET_KEY', SECRET);
		const { handleVuePageRequest } = await import('../../../src/vue');
		const { defineComponent, h } = await import('vue');

		const response = await handleVuePageRequest({
			indexPath: '/index.js',
			Page: defineComponent({ setup: () => () => h('p', 'hi') }),
			pagePath: '/tests/checkout.vue',
			props: { apiKey: SECRET }
		});
		const body = await response.text();

		// Vue turns a throw during render into its 500 page rather than a
		// rejection. What matters is what gets served: not the secret.
		expect(response.status).toBe(500);
		expect(body).not.toContain(SECRET);
	});

	test('an island', async () => {
		set('STRIPE_SECRET_KEY', SECRET);
		const { serializeIslandProps } =
			await import('../../../src/core/islands');

		// data-props is as public as the props script.
		expect(() => serializeIslandProps({ apiKey: SECRET })).toThrow(
			/STRIPE_SECRET_KEY/
		);
	});

	test('and let an ordinary page through', async () => {
		set('STRIPE_SECRET_KEY', SECRET);
		const { serializeIslandProps } =
			await import('../../../src/core/islands');

		expect(serializeIslandProps({ name: 'Ada' })).toBe('{"name":"Ada"}');
	});
});

/* This module is reachable from BROWSER code, which the guard has to
 * survive: an island re-derives its own marker attributes to find the
 * element it hydrates into (client/preserveIslandMarkup.ts →
 * getIslandMarkerAttributes → serializeIslandProps). Bun does not inline
 * `process.env`, so reading the environment there threw and the island
 * never hydrated. Found by the client-boundary build check
 * (src/build/clientServerBoundary.ts) on this repo's own example build. */
type BrowserIslandExports = {
	serializeIslandProps?: (props: unknown) => string;
};

describe('in a browser bundle, where there is no environment', () => {
	const browserBundle = async () => {
		const result = await Bun.build({
			entrypoints: ['src/core/islands.ts'],
			format: 'cjs',
			target: 'browser',
			throw: false
		});

		expect(result.success).toBe(true);

		return (await result.outputs[0]?.text()) ?? '';
	};

	/** Evaluates the bundle with `process` bound to undefined, which is as
	 *  close as this runtime gets to a browser's missing global. (There the
	 *  error is `ReferenceError: process is not defined`; here it is a
	 *  TypeError on `process.env` — the same crash either way.) */
	const evaluate = (code: string) => {
		const module: { exports: BrowserIslandExports } = { exports: {} };
		new Function('module', 'exports', 'process', code)(
			module,
			module.exports,
			undefined
		);

		return module.exports;
	};

	test('island props serialize without reading the environment', async () => {
		const { serializeIslandProps } = evaluate(await browserBundle());

		expect(serializeIslandProps?.({ name: 'Ada' })).toBe('{"name":"Ada"}');
	});

	test('and the guard is what makes that true', async () => {
		// Without it the same bundle throws, so this test cannot pass for
		// some other reason.
		const unguarded = (await browserBundle()).replace(
			/if \(typeof process === "undefined"\)\s*return \[\];?/,
			''
		);
		const { serializeIslandProps } = evaluate(unguarded);

		expect(() => serializeIslandProps?.({ name: 'Ada' })).toThrow(
			/process/
		);
	});
});
