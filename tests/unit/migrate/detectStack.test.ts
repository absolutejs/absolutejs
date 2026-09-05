import { describe, expect, test } from 'bun:test';
import { CONFIDENT, detectStack } from '../../../src/migrate/detect';

const manifest = (dependencies: Record<string, string>) => ({ dependencies });

describe('detectStack', () => {
	test('a dependency alone is enough to be confident', () => {
		const result = detectStack({
			files: [],
			manifest: manifest({ next: '15.0.0' })
		});

		expect(result.kind).toBe('nextjs');
		expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENT);
		expect(result.evidence).toEqual([
			{ detail: 'depends on next', source: 'package.json' }
		]);
	});

	test('a config file alone is a hint, not a verdict', () => {
		const result = detectStack({
			files: ['next.config.mjs'],
			manifest: null
		});

		// It found something, but not enough to act on without asking.
		expect(result.kind).toBe('nextjs');
		expect(result.confidence).toBeLessThan(CONFIDENT);
	});

	test('dependency and config together outrank either alone', () => {
		const one = detectStack({
			files: [],
			manifest: manifest({ next: '15.0.0' })
		});
		const both = detectStack({
			files: ['next.config.ts'],
			manifest: manifest({ next: '15.0.0' })
		});

		expect(both.confidence).toBeGreaterThan(one.confidence);
	});

	test('vite never outranks the framework built on top of it', () => {
		// Remix depends on vite. Crediting vite separately would let the build
		// tool win and send the migration down the wrong path.
		const result = detectStack({
			files: ['vite.config.ts'],
			manifest: manifest({
				'@remix-run/react': '2.0.0',
				vite: '5.0.0'
			})
		});

		expect(result.kind).toBe('remix');
		expect(result.alternates).not.toContain('vite');
	});

	test('vite still wins when it is the only thing present', () => {
		const result = detectStack({
			files: ['vite.config.ts'],
			manifest: manifest({ vite: '5.0.0' })
		});

		expect(result.kind).toBe('vite');
	});

	test('two equally-scored stacks lower confidence instead of coin-flipping', () => {
		const result = detectStack({
			files: [],
			manifest: manifest({ astro: '4.0.0', next: '15.0.0' })
		});

		// Deterministic pick, but the caller is told it is ambiguous rather
		// than handed a confident answer that came down to key order.
		expect(result.kind).toBe('nextjs');
		expect(result.alternates).toContain('astro');
		expect(result.confidence).toBeLessThan(CONFIDENT);
	});

	test('an unrecognisable repo admits it instead of guessing', () => {
		const result = detectStack({
			files: ['Makefile', 'main.go'],
			manifest: manifest({ lodash: '4.17.21' })
		});

		expect(result.kind).toBe('unknown');
		expect(result.confidence).toBe(0);
		expect(result.evidence).toEqual([]);
	});

	test('an existing AbsoluteJS project is recognised as one', () => {
		const result = detectStack({
			files: ['absolute.config.ts'],
			manifest: manifest({ '@absolutejs/absolute': '0.20.0-beta.77' })
		});

		expect(result.kind).toBe('absolutejs');
		expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENT);
	});

	test('nested config paths are matched by filename', () => {
		const result = detectStack({
			files: ['apps/web/next.config.js'],
			manifest: null
		});

		expect(result.kind).toBe('nextjs');
	});
});
