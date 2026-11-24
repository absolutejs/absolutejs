import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
	loadProductionTls,
	publishTlsConfig
} from '../../../src/runtime/productionTls';
import { createTlsFixture } from '../../helpers/tlsFixture';

/* TLS used to exist in development only, so a production server could
 * not terminate HTTPS or speak HTTP/2 at all. These are about the part
 * that is easy to get dangerously wrong: a server asked for HTTPS must
 * either serve HTTPS or not start. Every failure here is a throw, and
 * none of them is a fall back to plain HTTP. */

const MILLISECONDS_IN_A_DAY = 86_400_000;

let fixture: Awaited<ReturnType<typeof createTlsFixture>>;
let site: { cert: string; key: string };
let other: { cert: string; key: string };

beforeAll(async () => {
	fixture = await createTlsFixture();
	site = fixture.pair('site');
	other = fixture.pair('other');
});

afterAll(() => fixture.remove());

const load = (
	config: Parameters<typeof loadProductionTls>[0],
	env: Record<string, string | undefined> = {},
	now?: number
) => loadProductionTls(config, { cwd: fixture.directory, env, now });

describe('with nothing configured', () => {
	test('there is no TLS, and that is not an error', () => {
		expect(load(undefined)).toBeNull();
	});
});

describe('a certificate and key that belong together', () => {
	test('load, with HTTP/2 on', () => {
		const loaded = load(site);

		expect(loaded?.serve.http2).toBe(true);
		expect(loaded?.serve.tls.cert).toContain('BEGIN CERTIFICATE');
		expect(loaded?.serve.tls.key).toContain('PRIVATE KEY');
		expect(loaded?.warning).toBeUndefined();
	});

	test('a relative path is resolved from the working directory', () => {
		const loaded = load({
			cert: basename(site.cert),
			key: basename(site.key)
		});

		expect(loaded?.serve.tls.cert).toContain('BEGIN CERTIFICATE');
	});

	test('http2: false leaves HTTP/2 off', () => {
		expect(load({ ...site, http2: false })?.serve).not.toHaveProperty(
			'http2'
		);
	});

	test('a CA bundle is read when one is named', () => {
		const loaded = load({ ...site, ca: other.cert });

		expect(loaded?.serve.tls).toHaveProperty('ca');
	});
});

describe('the environment', () => {
	test('is enough on its own', () => {
		const loaded = load(undefined, {
			ABSOLUTE_TLS_CERT: site.cert,
			ABSOLUTE_TLS_KEY: site.key
		});

		expect(loaded?.serve.http2).toBe(true);
	});

	/* One build, a different certificate per deployment. */
	test('wins over the config', () => {
		const fromConfig = load(site);
		const fromEnv = load(site, {
			ABSOLUTE_TLS_CERT: other.cert,
			ABSOLUTE_TLS_KEY: other.key
		});

		expect(fromEnv?.serve.tls.cert).not.toBe(fromConfig?.serve.tls.cert);
	});

	test('can turn HTTP/2 off', () => {
		expect(
			load(site, { ABSOLUTE_TLS_HTTP2: 'false' })?.serve
		).not.toHaveProperty('http2');
	});
});

describe('a configuration that cannot be used stops the server', () => {
	test('a certificate without a key', () => {
		expect(() => load(undefined, { ABSOLUTE_TLS_CERT: site.cert })).toThrow(
			'a certificate is configured without a key'
		);
	});

	test('a key without a certificate', () => {
		expect(() => load(undefined, { ABSOLUTE_TLS_KEY: site.key })).toThrow(
			'a key is configured without a certificate'
		);
	});

	test('a file that is not there, named with its full path', () => {
		const missing = join(fixture.directory, 'gone.crt');

		expect(() => load({ cert: missing, key: site.key })).toThrow(missing);
		expect(() => load({ cert: missing, key: site.key })).toThrow(
			'did not start'
		);
	});

	/* The mistake that otherwise shows up as a handshake error on the
	 * first request, with nothing in it about why. */
	test('a key from a different pair', () => {
		expect(() => load({ cert: site.cert, key: other.key })).toThrow(
			'does not belong to the certificate'
		);
	});

	test('the two files swapped', () => {
		expect(() => load({ cert: site.key, key: site.cert })).toThrow(
			'is not a PEM certificate'
		);
	});

	test('a file that is not a key', async () => {
		const junk = join(fixture.directory, 'junk.key');
		await writeFile(junk, 'not a key\n');

		expect(() => load({ cert: site.cert, key: junk })).toThrow(
			'could not be read as a private key'
		);
	});
});

describe('expiry is said, and does not stop the server', () => {
	test('a certificate about to expire', () => {
		const soon = fixture.pair('soon', 3);
		const loaded = load(soon);

		expect(loaded?.serve.tls.cert).toContain('BEGIN CERTIFICATE');
		expect(loaded?.warning).toContain('expires in');
		expect(loaded?.warning).toContain('restarts');
	});

	test('a certificate that has expired', () => {
		const later = Date.now() + 365 * MILLISECONDS_IN_A_DAY;

		expect(load(site, {}, later)?.warning).toContain('expired on');
	});
});

describe('publishTlsConfig', () => {
	test('copies the config into the environment', () => {
		const env: Record<string, string | undefined> = {};
		publishTlsConfig({ ...site, ca: other.cert, http2: false }, env);

		expect(env).toEqual({
			ABSOLUTE_TLS_CA: other.cert,
			ABSOLUTE_TLS_CERT: site.cert,
			ABSOLUTE_TLS_HTTP2: 'false',
			ABSOLUTE_TLS_KEY: site.key
		});
	});

	test('leaves alone what the environment already says', () => {
		const env: Record<string, string | undefined> = {
			ABSOLUTE_TLS_CERT: other.cert
		};
		publishTlsConfig(site, env);

		expect(env.ABSOLUTE_TLS_CERT).toBe(other.cert);
		expect(env.ABSOLUTE_TLS_KEY).toBe(site.key);
	});

	test('does nothing without a config', () => {
		const env: Record<string, string | undefined> = {};
		publishTlsConfig(undefined, env);

		expect(env).toEqual({});
	});
});
