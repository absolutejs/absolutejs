import { describe, expect, test } from 'bun:test';
import {
	findIslandFrameworkDirectoryProblems,
	islandFrameworkDirectoryMessage
} from '../../../src/build/islandFrameworkDirectories';

/* An island registry may name a component of any framework, but the build
 * only compiles a framework's island sources when that framework's PAGES
 * directory is configured. Without it the island entry has no compiled
 * client path, `islandEntries` emits the registry definition instead, and
 * its `component` is null — so the build succeeded and the island could
 * never hydrate. A green build producing a dead feature is the worst
 * available outcome; this is the check that refuses it. */

describe('an island whose framework directory is missing', () => {
	test('is reported, with the key to set', () => {
		const problems = findIslandFrameworkDirectoryProblems({
			configured: { react: true, svelte: false },
			sources: { svelte: ['islands/Ticker.svelte'] }
		});

		expect(problems).toEqual([
			{
				configKey: 'svelteDirectory',
				framework: 'svelte',
				sources: ['islands/Ticker.svelte']
			}
		]);

		const message = islandFrameworkDirectoryMessage(problems);

		expect(message).toContain('islands/Ticker.svelte');
		expect(message).toContain('svelteDirectory');
		// The consequence, so the message explains itself rather than
		// reading as a style preference.
		expect(message).toContain('never hydrate');
	});

	test('every offending framework is listed, not just the first', () => {
		const problems = findIslandFrameworkDirectoryProblems({
			configured: { react: true },
			sources: {
				svelte: ['islands/A.svelte'],
				vue: ['islands/B.vue']
			}
		});

		expect(problems.map((problem) => problem.framework).sort()).toEqual([
			'svelte',
			'vue'
		]);
	});
});

describe('what is not a problem', () => {
	test('a framework whose directory is configured', () => {
		expect(
			findIslandFrameworkDirectoryProblems({
				configured: { svelte: true },
				sources: { svelte: ['islands/Ticker.svelte'] }
			})
		).toEqual([]);
	});

	test('a framework with no islands at all', () => {
		// Not configuring Vue is only a problem if something needs Vue.
		expect(
			findIslandFrameworkDirectoryProblems({
				configured: { svelte: true },
				sources: { svelte: ['islands/Ticker.svelte'], vue: [] }
			})
		).toEqual([]);
	});

	test('a registry with no islands', () => {
		expect(
			findIslandFrameworkDirectoryProblems({
				configured: {},
				sources: {}
			})
		).toEqual([]);
	});

	test('a framework this check does not know about', () => {
		// Only the four with a directory key are gated; an unknown
		// framework must not fail the build on a made-up config key.
		expect(
			findIslandFrameworkDirectoryProblems({
				configured: {},
				sources: { ember: ['islands/Thing.gjs'] }
			})
		).toEqual([]);
	});
});
