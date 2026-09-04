import { afterEach, describe, expect, test } from 'bun:test';
import {
	mkdtempSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanVueSsrOnlyPages } from '../../../src/build/scanVueSsrOnlyPages';

const tempDirs: string[] = [];

const ssrOnlyServer = (name: string) =>
	`handleVuePageRequest({ client: 'none', pagePath: asset(manifest, '${name}') });`;

const hydratedServer = (name: string) =>
	`handleVuePageRequest({ pagePath: asset(manifest, '${name}') });`;

/* Byte-identical lengths, so a rewrite between the two changes nothing a
 * `(mtimeMs, size)` stamp can see. That is the only way to tell a real memo
 * apart from a rescan, and the only way to reproduce a coarse-mtime
 * filesystem's worst case on a nanosecond-resolution one. */
const SAME_LENGTH_SSR_ONLY = ssrOnlyServer('LandingPage');
const SAME_LENGTH_HYDRATED = `${hydratedServer('LandingPage')} //`.padEnd(
	SAME_LENGTH_SSR_ONLY.length,
	'-'
);

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('vue ssr-only page scanning', () => {
	test('reads the literal manifest key of a client:none page', () => {
		const dir = mkdtempSync(join(tmpdir(), 'absolute-ssr-only-'));
		tempDirs.push(dir);
		writeFileSync(join(dir, 'server.ts'), ssrOnlyServer('LandingPage'));

		expect(scanVueSsrOnlyPages(dir)).toEqual(new Set(['LandingPage']));
	});

	test('memoised scans see a page that becomes ssr-only after the first scan', () => {
		const dir = mkdtempSync(join(tmpdir(), 'absolute-ssr-only-memo-'));
		tempDirs.push(dir);
		const server = join(dir, 'server.ts');
		writeFileSync(server, hydratedServer('LandingPage'));

		expect(scanVueSsrOnlyPages(dir, true)).toEqual(new Set());

		writeFileSync(server, ssrOnlyServer('LandingPage'));

		expect(scanVueSsrOnlyPages(dir, true)).toEqual(
			new Set(['LandingPage'])
		);
	});

	test('memoised scans see a page that stops being ssr-only', () => {
		const dir = mkdtempSync(join(tmpdir(), 'absolute-ssr-only-memo-drop-'));
		tempDirs.push(dir);
		const server = join(dir, 'server.ts');
		writeFileSync(server, ssrOnlyServer('LandingPage'));

		expect(scanVueSsrOnlyPages(dir, true)).toEqual(
			new Set(['LandingPage'])
		);

		writeFileSync(server, hydratedServer('LandingPage'));

		expect(scanVueSsrOnlyPages(dir, true)).toEqual(new Set());
	});

	test('memoised scans reuse the parse of a file whose stamp is unchanged', () => {
		const dir = mkdtempSync(join(tmpdir(), 'absolute-ssr-only-memo-hit-'));
		tempDirs.push(dir);
		const server = join(dir, 'server.ts');
		writeFileSync(server, SAME_LENGTH_HYDRATED);
		// Backdate past the settle window so the stamp is trusted.
		const past = new Date(Date.now() - 60_000);
		utimesSync(server, past, past);
		const { mtime } = statSync(server);

		expect(scanVueSsrOnlyPages(dir, true)).toEqual(new Set());

		writeFileSync(server, SAME_LENGTH_SSR_ONLY);
		utimesSync(server, mtime, mtime);

		expect(scanVueSsrOnlyPages(dir, true)).toEqual(new Set());
		expect(scanVueSsrOnlyPages(dir)).toEqual(new Set(['LandingPage']));
	});

	test('memoised scans never trust the stamp of a just-written file', () => {
		const dir = mkdtempSync(
			join(tmpdir(), 'absolute-ssr-only-memo-settle-')
		);
		tempDirs.push(dir);
		const server = join(dir, 'server.ts');
		writeFileSync(server, SAME_LENGTH_HYDRATED);
		const { mtime } = statSync(server);

		expect(scanVueSsrOnlyPages(dir, true)).toEqual(new Set());

		// Coarse-mtime filesystem worst case: identical mtime and size after
		// a real edit. Files touched inside the settle window are recomputed,
		// so the edit is still seen.
		writeFileSync(server, SAME_LENGTH_SSR_ONLY);
		utimesSync(server, mtime, mtime);

		expect(scanVueSsrOnlyPages(dir, true)).toEqual(
			new Set(['LandingPage'])
		);
	});

	test('memoised scans see a newly added ssr-only registration file', () => {
		const dir = mkdtempSync(join(tmpdir(), 'absolute-ssr-only-memo-add-'));
		tempDirs.push(dir);
		writeFileSync(join(dir, 'server.ts'), hydratedServer('LandingPage'));

		expect(scanVueSsrOnlyPages(dir, true)).toEqual(new Set());

		writeFileSync(join(dir, 'routes.ts'), ssrOnlyServer('AboutPage'));

		expect(scanVueSsrOnlyPages(dir, true)).toEqual(new Set(['AboutPage']));
	});
});
