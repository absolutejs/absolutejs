import { describe, expect, test } from 'bun:test';
import type { StaticConfig } from '../../../types/build';
import { productionRuntimeConfigOf } from '../../../src/core/productionRuntime';
import {
	isRevalidateTokenMissing,
	REVALIDATE_TOKEN_ENV,
	revalidateTokenFor,
	STATIC_DIRECTORY_ENV,
	staticDirectoryFor,
	withoutRevalidateToken
} from '../../../src/core/staticRuntimeOptions';

/* A production server does not read the config file; it reads what the
 * build wrote down from it. These are the two settings that must not be
 * decided on the build machine: a path that differs per machine, and a
 * secret that must not be in the build at all. */

const TOKEN = 'a-long-random-secret-value';
const configured: StaticConfig = {
	directory: '/from/config',
	revalidateToken: TOKEN,
	routes: ['/']
};

describe('static.directory at run time', () => {
	test('is the environment’s when it is set', () => {
		expect(
			staticDirectoryFor(configured, {
				[STATIC_DIRECTORY_ENV]: '/from/env'
			})
		).toBe('/from/env');
	});

	test('is the config’s otherwise, including for an empty variable', () => {
		expect(staticDirectoryFor(configured, {})).toBe('/from/config');
		expect(
			staticDirectoryFor(configured, { [STATIC_DIRECTORY_ENV]: '' })
		).toBe('/from/config');
	});

	test('can be given to an app whose config has none, or no static at all', () => {
		const env: Record<string, string> = {
			[STATIC_DIRECTORY_ENV]: '/from/env'
		};

		expect(staticDirectoryFor({ routes: ['/'] }, env)).toBe('/from/env');
		expect(staticDirectoryFor(undefined, env)).toBe('/from/env');
		expect(staticDirectoryFor(undefined, {})).toBeUndefined();
	});
});

describe('the revalidation token at run time', () => {
	test('is the environment’s when it is set', () => {
		expect(
			revalidateTokenFor(configured, {
				[REVALIDATE_TOKEN_ENV]: 'from-env'
			})
		).toBe('from-env');
	});

	test('is the config’s when the config was loaded from source', () => {
		expect(revalidateTokenFor(configured, {})).toBe(TOKEN);
	});
});

describe('what the build writes down', () => {
	test('has no token in it', () => {
		const written = withoutRevalidateToken(configured);

		expect(JSON.stringify(written)).not.toContain(TOKEN);
		expect(written).toMatchObject({
			directory: '/from/config',
			routes: ['/']
		});
	});

	test('is untouched when there was no token to remove', () => {
		const plain: StaticConfig = { routes: ['/'] };

		expect(withoutRevalidateToken(plain)).toBe(plain);
		expect(withoutRevalidateToken(undefined)).toBeUndefined();
	});

	/* The file `absolute start` writes beside the build, and the config
	 * `absolute compile` embeds, both come through this. */
	test('the production runtime config carries no token', () => {
		const runtime = productionRuntimeConfigOf({ static: configured });

		expect(JSON.stringify(runtime)).not.toContain(TOKEN);
		expect(runtime.static?.routes).toEqual(['/']);
		expect(runtime.static?.revalidateToken).toBeUndefined();
	});
});

describe('a server built with a token and started without one', () => {
	const written = JSON.parse(
		JSON.stringify(withoutRevalidateToken(configured))
	);

	/* Otherwise the endpoint is simply not there, and nothing says why. */
	test('is told the token is missing', () => {
		expect(isRevalidateTokenMissing(written, {})).toBe(true);
	});

	test('is not, once the environment supplies it', () => {
		expect(
			isRevalidateTokenMissing(written, { [REVALIDATE_TOKEN_ENV]: TOKEN })
		).toBe(false);
		expect(
			revalidateTokenFor(written, { [REVALIDATE_TOKEN_ENV]: TOKEN })
		).toBe(TOKEN);
	});

	test('nor is an app that never configured a token', () => {
		expect(isRevalidateTokenMissing({ routes: ['/'] }, {})).toBe(false);
		expect(isRevalidateTokenMissing(undefined, {})).toBe(false);
	});
});
