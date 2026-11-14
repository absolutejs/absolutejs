import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
	deriveManifestKeys,
	MANIFEST_KEYS_DECLARATION,
	type DerivedManifestKeys
} from '../../../src/build/manifestKeys';
import { build } from '../../../src/core/build';
import {
	MANIFEST_KEYS_FIXTURE_CONFIG,
	writeManifestKeysFixture
} from '../../helpers/manifestKeysFixture';

/* The guard against drift between the manifest keys `asset(manifest, key)`
 * is typed with — derived from the source tree, without building — and the
 * keys a real build writes. The fixture uses React (a kebab-case page and
 * a page importing CSS), Svelte and Vue pages with child components and
 * styles, an Angular page, static HTML with a script, HTMX, global
 * stylesheets, and React/Svelte/Vue islands with a configured bootstrap.
 *
 * Every key the build writes must be derived (or match a pattern: shared
 * chunks are named by content hash), and every key derived as `definite`
 * must be one the build writes. `possible` keys (a page's stylesheet, an
 * island's stylesheet) may or may not be written. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const testBuildRoot = join(repoRoot, '.test-builds');
const originalCwd = process.cwd();
let fixtureRoot = '';
let manifest: Record<string, string> = {};
let derived: DerivedManifestKeys = {
	definite: new Set(),
	patterns: [],
	possible: new Set()
};

beforeAll(async () => {
	await mkdir(testBuildRoot, { recursive: true });
	fixtureRoot = await mkdtemp(join(testBuildRoot, 'manifest-keys-'));
	await writeManifestKeysFixture(fixtureRoot);
	process.chdir(fixtureRoot);
	try {
		derived = await deriveManifestKeys(
			MANIFEST_KEYS_FIXTURE_CONFIG,
			fixtureRoot
		);
		const result = await build({
			...MANIFEST_KEYS_FIXTURE_CONFIG,
			mode: 'production',
			options: { throwOnError: true }
		});
		manifest = result?.manifest ?? {};
	} finally {
		process.chdir(originalCwd);
	}
}, 600_000);

afterAll(async () => {
	process.chdir(originalCwd);
	if (fixtureRoot) await rm(fixtureRoot, { force: true, recursive: true });
});

const CHUNK_KEY = /^Chunk[a-z0-9]+$/i;

describe('manifest keys derived without a build', () => {
	test('every key the build writes is derived', () => {
		const accepted = new Set([...derived.definite, ...derived.possible]);
		const built = Object.keys(manifest);
		const underived = built.filter(
			(key) => !accepted.has(key) && !CHUNK_KEY.test(key)
		);

		expect(built.length).toBeGreaterThan(20);
		expect(underived).toEqual([]);
		expect(derived.patterns).toContain('Chunk${string}');
	});

	test('every definite key is one the build writes', () => {
		const missing = [...derived.definite].filter(
			(key) => manifest[key] === undefined
		);

		expect(missing).toEqual([]);
	});

	test('covers every page framework, styles and islands', () => {
		expect([...derived.definite].sort()).toEqual(
			[
				'AboutUsIndex',
				'AbsoluteIslandBootstrap',
				'AngularDashboard',
				'AngularDashboardIndex',
				'Bootstrap',
				'GlobalThemeCSS',
				'HtmlCounter',
				'HtmlHome',
				'HtmxHome',
				'IslandReactReactCounter',
				'IslandSvelteSvelteCounter',
				'IslandVueVueCounter',
				'PrintCSS',
				'ReactHomeIndex',
				'SveltePricing',
				'SveltePricingClient',
				'SveltePricingIndex',
				'VueProfile',
				'VueProfileClient',
				'VueProfileIndex'
			].sort()
		);
	});

	test('the build writes the declaration with those keys', async () => {
		const declaration = await readFile(
			join(fixtureRoot, MANIFEST_KEYS_DECLARATION),
			'utf-8'
		);

		for (const key of [...derived.definite, ...derived.possible])
			expect(declaration).toContain(`${JSON.stringify(key)}: true;`);
		expect(declaration).toContain('[key: `Chunk${string}`]: true;');
	});
});
