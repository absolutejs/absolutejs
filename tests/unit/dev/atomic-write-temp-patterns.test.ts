import { describe, expect, test } from 'bun:test';
import { isAtomicWriteTemp } from '../../../src/dev/serverEntryWatcher';

/* Editor / shell tools that write atomically (write tmp, rename
 * over original) produce transient filenames the file watcher
 * sees first. Without filtering them, the watcher would queue an
 * HMR cycle for the tmp file and then another for the final
 * rename — double work + a stale broadcast for a file that doesn't
 * exist anymore. The `isAtomicWriteTemp` regex set is the gate. */
describe('isAtomicWriteTemp', () => {
	test('matches `.tmp` suffix', () => {
		expect(isAtomicWriteTemp('server.ts.tmp')).toBe(true);
		expect(isAtomicWriteTemp('counter.component.html.tmp')).toBe(true);
	});

	test('matches `.tmp.` substring (Prettier intermediate)', () => {
		expect(isAtomicWriteTemp('server.ts.tmp.abc123')).toBe(true);
		expect(isAtomicWriteTemp('a.tmp.b')).toBe(true);
	});

	test('matches `~` suffix (Emacs/Vim/IDE backup)', () => {
		expect(isAtomicWriteTemp('server.ts~')).toBe(true);
		expect(isAtomicWriteTemp('counter.component.html~')).toBe(true);
	});

	test('matches `.#` prefix (Emacs lockfile)', () => {
		expect(isAtomicWriteTemp('.#server.ts')).toBe(true);
		expect(isAtomicWriteTemp('.#counter.component.html')).toBe(true);
	});

	test('matches `sed<random>` (sed -i in-place tmp)', () => {
		expect(isAtomicWriteTemp('sedABC123def')).toBe(true);
		expect(isAtomicWriteTemp('sedXYZ789012345')).toBe(true);
	});

	test('does NOT match `sed` standalone (too short to be sed-tmp)', () => {
		expect(isAtomicWriteTemp('sed')).toBe(false);
		expect(isAtomicWriteTemp('sedAB12')).toBe(false);
	});

	test('matches `4913` (vim preflight write probe)', () => {
		expect(isAtomicWriteTemp('4913')).toBe(true);
	});

	test('does NOT match a real source filename', () => {
		expect(isAtomicWriteTemp('server.ts')).toBe(false);
		expect(isAtomicWriteTemp('counter.component.ts')).toBe(false);
		expect(isAtomicWriteTemp('VueExample.vue')).toBe(false);
		expect(isAtomicWriteTemp('SvelteExample.svelte')).toBe(false);
		expect(isAtomicWriteTemp('HTMLExample.html')).toBe(false);
		expect(isAtomicWriteTemp('absolute.config.ts')).toBe(false);
	});

	test('does NOT match dotfiles that ARE source (not lockfiles)', () => {
		expect(isAtomicWriteTemp('.eslintrc.json')).toBe(false);
		expect(isAtomicWriteTemp('.gitignore')).toBe(false);
		expect(isAtomicWriteTemp('.env')).toBe(false);
	});

	test('matches `4913` exactly (not as substring)', () => {
		// The regex is anchored so longer names containing "4913"
		// don't match.
		expect(isAtomicWriteTemp('foo4913.ts')).toBe(false);
		expect(isAtomicWriteTemp('4913.ts')).toBe(false);
	});
});
