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
