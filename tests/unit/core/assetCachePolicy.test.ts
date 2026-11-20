import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	assetCacheControl,
	isFingerprintedAsset
} from '../../../src/core/precompressed';

/* `immutable` tells a browser never to revalidate, so the only safe thing
 * to mark it with is a URL that changes when its content does.
 *
 * The old rule guessed from the name: a 6-12 character segment mixing
 * letters and digits was taken for a content hash. That caught the most
 * conventional hand-named assets there are — a PWA icon at
 * `icon-512x512.png` was pinned in every visitor's browser for a year,
 * and replacing it on a rebrand reached nobody. */

const HASHED = new Set([
	'/indexes/react-example.9verrxzf.css',
	'/example/html/scripts/typescript-example.jz0jh2j8.js'
]);

const immutable = (pathname: string) => isFingerprintedAsset(pathname, HASHED);

describe('what may be cached forever', () => {
	test("the framework's own hashes", () => {
		// fontAssets' fingerprint(): exactly eight hex characters.
		expect(immutable('/assets/fonts/inter.1a2b3c4d.woff2')).toBe(true);
		// The bundler's code-splitting chunks, which the manifest does not
		// list individually.
		expect(immutable('/chunk-k3x9a0bq.js')).toBe(true);
		expect(immutable('/react/rsc/chunk-0a1b2c3d4e.js')).toBe(true);
		// The hydration bundles.
		expect(immutable('/.absolutejs/hydrate.js')).toBe(true);
	});

	test('anything the build recorded as hashed', () => {
		// Bun's `[hash]` is base36, wider than hex, so these are known by
		// the manifest rather than by their shape.
		expect(immutable('/indexes/react-example.9verrxzf.css')).toBe(true);
		expect(
			immutable('/example/html/scripts/typescript-example.jz0jh2j8.js')
		).toBe(true);
	});

	test('a base36-looking name the build did not record', () => {
		// Fails towards a round trip, not towards a stale year.
		expect(immutable('/indexes/unknown.9verrxzf.css')).toBe(false);
	});
});

describe('what must revalidate', () => {
	const handNamed = [
		// Each of these was pinned for a year by the old rule.
		'/icons/icon-192x192.png',
		'/icons/icon-512x512.png',
		'/assets/icons-sprite24.svg',
		'/video/clip-1080p60.mp4',
		'/assets/photo-v2final.jpg',
		'/img/logo-2026q1.svg'
	];

	test('a hand-named file that merely looks hashed', () => {
		expect(handNamed.filter(immutable)).toEqual([]);
	});

	test('a stable name whose content changes on deploy', () => {
		expect(immutable('/assets/tailwind.generated.css')).toBe(false);
		expect(immutable('/assets/hero.webp')).toBe(false);
	});

	test('the policy strings say forever or revalidate', () => {
		expect(assetCacheControl('/chunk-k3x9a0bq.js')).toBe(
			'public, max-age=31536000, immutable'
		);
		expect(assetCacheControl('/icons/icon-512x512.png')).toBe(
			'public, max-age=0, must-revalidate'
		);
	});
});

/* The compiled standalone binary carries its own copy of this rule, in a
 * generated source file that cannot import the package at runtime. A
 * second copy is how the pre-render mapping drifted (beta.228), so this
 * holds the two to the same answers. */
describe('the compiled binary agrees', () => {
	const source = readFileSync(
		resolve(import.meta.dir, '../../../src/cli/scripts/compile.ts'),
		'utf-8'
	);

	test('its rule tests the same three shapes and the recorded set', () => {
		const rule = source.slice(
			source.indexOf('const isFingerprintedAsset = (p: string) => {'),
			source.indexOf('// ── Server ──')
		);

		expect(rule).toContain('/.absolutejs/');
		expect(rule).toContain('chunk-[0-9a-z]{8,}');
		expect(rule).toContain('[0-9a-f]{8}');
		expect(rule).toContain('HASHED_ASSETS.has(p)');
		// And no trace of the rule it replaced.
		expect(rule).not.toContain('{6,12}');
	});

	test('it inlines the manifest paths rather than guessing', () => {
		expect(source).toContain('const HASHED_ASSETS = new Set<string>');
		expect(source).toContain("join(distDir, 'manifest.json')");
	});
});
