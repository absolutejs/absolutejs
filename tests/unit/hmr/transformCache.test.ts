import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
	getInvalidationVersion,
	getTransformed,
	invalidate,
	invalidateAll,
	setTransformed
} from '../../../src/dev/transformCache';

const reset = () => {
	invalidateAll();
};

beforeEach(() => {
	reset();
});

afterEach(() => {
	reset();
});

describe('transformCache.invalidate', () => {
	test('clears the changed file and bumps its version', () => {
		setTransformed('a.ts', 'a-v1', 1, []);
		expect(getTransformed('a.ts')).toBe('a-v1');
		expect(getInvalidationVersion('a.ts')).toBe(0);

		invalidate('a.ts');

		expect(getTransformed('a.ts')).toBeUndefined();
		expect(getInvalidationVersion('a.ts')).toBe(1);
	});

	test('cascades to direct importers (depth 1)', () => {
		// b imports a; when a changes, b's cache must be cleared so it's
		// re-transpiled with the new ?v= for a.
		setTransformed('a.ts', 'a-v1', 1, []);
		setTransformed('b.ts', 'b-v1', 1, ['a.ts']);

		invalidate('a.ts');

		expect(getTransformed('a.ts')).toBeUndefined();
		expect(getTransformed('b.ts')).toBeUndefined();
	});

	test('cascades through transitive importers (depth ≥ 2)', () => {
		// c → b → a (c imports b imports a). Editing a must invalidate b
		// AND c, otherwise c's cached transform keeps a stale `?v=` for
		// b's URL and the browser bundle wedges. This is the bug fixed
		// on 2026-05-05.
		setTransformed('a.ts', 'a-v1', 1, []);
		setTransformed('b.ts', 'b-v1', 1, ['a.ts']);
		setTransformed('c.ts', 'c-v1', 1, ['b.ts']);
		setTransformed('d.ts', 'd-v1', 1, ['c.ts']);

		invalidate('a.ts');

		expect(getTransformed('a.ts')).toBeUndefined();
		expect(getTransformed('b.ts')).toBeUndefined();
		expect(getTransformed('c.ts')).toBeUndefined();
		expect(getTransformed('d.ts')).toBeUndefined();
	});

	test('bumps invalidationVersion for every transitive importer', () => {
		// Without bumping importers' versions, srcUrl(`b.ts`) keeps
		// returning the same `?v=` token even though b's cache was
		// cleared — the browser then never refetches b. So we assert
		// versions bump up the entire chain.
		setTransformed('a.ts', 'a-v1', 1, []);
		setTransformed('b.ts', 'b-v1', 1, ['a.ts']);
		setTransformed('c.ts', 'c-v1', 1, ['b.ts']);

		invalidate('a.ts');

		expect(getInvalidationVersion('a.ts')).toBe(1);
		expect(getInvalidationVersion('b.ts')).toBe(1);
		expect(getInvalidationVersion('c.ts')).toBe(1);
	});

	test('handles diamond dependencies without double-counting', () => {
		// Diamond: d → b → a, d → c → a. Walking the graph, a's
		// importers are {b, c}; both lead to d. d should be visited
		// once with version=1, not twice.
		setTransformed('a.ts', 'a-v1', 1, []);
		setTransformed('b.ts', 'b-v1', 1, ['a.ts']);
		setTransformed('c.ts', 'c-v1', 1, ['a.ts']);
		setTransformed('d.ts', 'd-v1', 1, ['b.ts', 'c.ts']);

		invalidate('a.ts');

		expect(getInvalidationVersion('d.ts')).toBe(1);
	});

	test('tolerates import cycles', () => {
		// a → b → a. The visited set must prevent an infinite loop.
		setTransformed('a.ts', 'a-v1', 1, ['b.ts']);
		setTransformed('b.ts', 'b-v1', 1, ['a.ts']);

		expect(() => invalidate('a.ts')).not.toThrow();

		expect(getTransformed('a.ts')).toBeUndefined();
		expect(getTransformed('b.ts')).toBeUndefined();
		expect(getInvalidationVersion('a.ts')).toBe(1);
		expect(getInvalidationVersion('b.ts')).toBe(1);
	});

	test('only bumps versions on the touched subgraph', () => {
		// Editing a must not bump z, which is unrelated.
		setTransformed('a.ts', 'a-v1', 1, []);
		setTransformed('b.ts', 'b-v1', 1, ['a.ts']);
		setTransformed('z.ts', 'z-v1', 1, []);

		invalidate('a.ts');

		expect(getInvalidationVersion('z.ts')).toBe(0);
		expect(getTransformed('z.ts')).toBe('z-v1');
	});
});
