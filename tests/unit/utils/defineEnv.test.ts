import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Type } from '@sinclair/typebox';
import { defineEnv } from '../../../src/utils/defineEnv';
import { ENV_FORMATS } from '../../../src/utils/envFormats';
import { ENV_INSPECT_VARIABLE } from '../../../src/utils/envInspect';

/* `defineEnv` shipped with no caller, no test and no documentation
 * anywhere in the repo, and two things were wrong with it in practice:
 * a schema naming a string format could never pass, and no tool could
 * read the schema without being stopped by the validation it exists to
 * report on. */

const saved: Record<string, string | undefined> = { ...process.env };

beforeEach(() => {
	for (const key of Object.keys(process.env))
		if (!(key in saved)) delete process.env[key];
});

afterEach(() => {
	for (const key of Object.keys(process.env))
		if (!(key in saved)) delete process.env[key];
});

describe('reading the environment', () => {
	test('a default fills in for a variable that is not set', () => {
		expect(defineEnv({ PORT: Type.Number({ default: 3000 }) }).PORT).toBe(
			3000
		);
	});

	/* Everything arrives as a string, so a schema asking for a number has
	 * to coerce or no numeric variable could ever be declared. */
	test('a numeric string is coerced', () => {
		process.env.PORT = '8080';

		expect(defineEnv({ PORT: Type.Number() }).PORT).toBe(8080);
	});

	test('a missing required variable names itself in the failure', () => {
		expect(() => defineEnv({ DATABASE_URL: Type.String() })).toThrow(
			/DATABASE_URL — required but not set/u
		);
	});

	test('a value of the wrong type says what it got', () => {
		process.env.PORT = 'notanumber';

		expect(() => defineEnv({ PORT: Type.Number() })).toThrow(
			/PORT — Expected number, got "notanumber"/u
		);
	});

	/* The value of a secret is not printed back, which is the one place a
	 * validation summary would otherwise leak one. */
	test('a sensitive value is reported as set, not shown', () => {
		process.env.API_SECRET = 'sk_live_not_for_logs';
		process.env.PORT = 'notanumber';

		expect(() =>
			defineEnv({ API_SECRET: Type.String(), PORT: Type.Number() })
		).toThrow(/API_SECRET — set/u);
		expect(() =>
			defineEnv({ API_SECRET: Type.String(), PORT: Type.Number() })
		).not.toThrow(/sk_live_not_for_logs/u);
	});
});

describe('string formats', () => {
	/* TypeBox holds no format validators of its own and fails CLOSED on a
	 * format it does not know, so this rejected every value — including
	 * correct ones — with `Unknown format 'uri'`. An app declaring its
	 * database URL the obvious way could not start. */
	test('a valid uri passes', () => {
		process.env.DATABASE_URL = 'postgres://user:pw@localhost:5432/db';

		expect(
			defineEnv({ DATABASE_URL: Type.String({ format: 'uri' }) })
				.DATABASE_URL
		).toBe('postgres://user:pw@localhost:5432/db');
	});

	test('an invalid uri fails, naming the format', () => {
		process.env.DATABASE_URL = 'not a uri at all';

		expect(() =>
			defineEnv({ DATABASE_URL: Type.String({ format: 'uri' }) })
		).toThrow(/match 'uri' format/u);
	});

	/* `uri` is absolute. The first version of this accepted a relative one
	 * too, by falling back to parsing against a base — which made the
	 * format accept ANY string, since every string is a legal relative
	 * path. A format that passes everything is worse than none, because it
	 * reads like a constraint. */
	test('a relative reference is not a uri', () => {
		expect(ENV_FORMATS.uri?.('/callback')).toBe(false);
		expect(ENV_FORMATS['uri-reference']?.('/callback')).toBe(true);
	});

	test('the registered formats accept and reject', () => {
		expect(ENV_FORMATS.email?.('nobody@example.invalid')).toBe(true);
		expect(ENV_FORMATS.email?.('nobody@invalid')).toBe(false);
		expect(ENV_FORMATS.ipv4?.('127.0.0.1')).toBe(true);
		expect(ENV_FORMATS.ipv4?.('127.0.0.256')).toBe(false);
		expect(ENV_FORMATS.uuid?.('00000000-0000-4000-8000-000000000000')).toBe(
			true
		);
		expect(ENV_FORMATS.uuid?.('nope')).toBe(false);
	});
});

describe('inspection, for a tool reading the schema', () => {
	/* `absolute env` has to report which variables are missing, so it
	 * cannot be stopped by the throw that reports one. */
	test('nothing throws when no variable is set', () => {
		process.env[ENV_INSPECT_VARIABLE] = '1';

		expect(() =>
			defineEnv({
				DATABASE_URL: Type.String({ format: 'uri' }),
				PORT: Type.Number()
			})
		).not.toThrow();
	});

	/* A formatted string with no default is exactly what `Value.Create`
	 * refuses, so the placeholders are built here instead — the first
	 * version of this failed on the very case the format registry exists
	 * for. */
	test('a formatted variable with no default still inspects', () => {
		process.env[ENV_INSPECT_VARIABLE] = '1';
		const inspected = defineEnv({
			WEBHOOK: Type.String({ format: 'uri' })
		});

		expect(typeof inspected.WEBHOOK).toBe('string');
	});

	test('a module reading a variable at import time still evaluates', () => {
		process.env[ENV_INSPECT_VARIABLE] = '1';
		const inspected = defineEnv({ PORT: Type.Number() });

		expect(typeof inspected.PORT).toBe('number');
	});
});
