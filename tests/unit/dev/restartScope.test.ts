import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { changeNeedsRestart } from '../../../src/dev/restartScope';
import { setI18nRouting } from '../../../src/utils/i18nRoutingRef';

const loaded = new Set(['/app/src/backend/routes.ts', '/app/src/lib/db.js']);
const isLoaded = (path: string) => loaded.has(path);

describe('changeNeedsRestart', () => {
	test('documents and test files never restart the server', () => {
		expect(changeNeedsRestart('/app/docs/guide.md', isLoaded)).toBe(false);
		expect(changeNeedsRestart('/app/NOTES.txt', isLoaded)).toBe(false);
		expect(changeNeedsRestart('/app/tests/routes.test.ts', isLoaded)).toBe(
			false
		);
		expect(
			changeNeedsRestart('/app/src/__tests__/helper.ts', isLoaded)
		).toBe(false);
	});

	test('code restarts the server only when this process loaded it', () => {
		expect(changeNeedsRestart('/app/src/backend/routes.ts', isLoaded)).toBe(
			true
		);
		expect(changeNeedsRestart('/app/src/lib/db.js', isLoaded)).toBe(true);
		expect(
			changeNeedsRestart('/app/tests/fixtures/schema.ts', isLoaded)
		).toBe(false);
		expect(changeNeedsRestart('/app/scripts/seed.ts', isLoaded)).toBe(
			false
		);
	});

	test('config read at startup still restarts the server', () => {
		expect(changeNeedsRestart('/app/.env', isLoaded)).toBe(true);
		expect(changeNeedsRestart('/app/.env.local', isLoaded)).toBe(true);
		expect(changeNeedsRestart('/app/package.json', isLoaded)).toBe(true);
		expect(changeNeedsRestart('/app/tsconfig.json', isLoaded)).toBe(true);
	});

	test('by default it asks the running process what it loaded', () => {
		// This test imported restartScope.ts, so this process loaded it.
		expect(
			changeNeedsRestart(
				resolve(import.meta.dir, '../../../src/dev/restartScope.ts')
			)
		).toBe(true);
		expect(changeNeedsRestart('/nowhere/never-imported.ts')).toBe(false);
	});

	test('a directory never restarts the server', () => {
		const root = mkdtempSync(join(tmpdir(), 'restart-scope-'));
		try {
			const assets = join(root, 'assets');
			mkdirSync(assets);
			writeFileSync(join(root, '.env'), 'A=1\n');
			expect(changeNeedsRestart(assets, isLoaded)).toBe(false);
			// An extensionless file next to it still does.
			expect(changeNeedsRestart(join(root, '.env'), isLoaded)).toBe(true);
		} finally {
			rmSync(root, { force: true, recursive: true });
		}
	});

	/* A message catalog the config names (`i18n.catalogs`). One a loader
	 * reads when a request needs it is read again by the next request;
	 * one imported as a module is held by this process. */
	test('a declared catalog restarts only when this process loaded it', () => {
		const root = mkdtempSync(join(tmpdir(), 'restart-scope-'));
		const french = join(root, 'fr.json');
		const german = join(root, 'de.json');
		const other = join(root, 'settings.json');
		for (const file of [french, german, other]) writeFileSync(file, '{}');
		setI18nRouting({
			catalogs: { de: german, fr: french },
			defaultLocale: 'en',
			locales: ['en', 'fr', 'de']
		});
		try {
			expect(changeNeedsRestart(french, () => false)).toBe(false);
			expect(changeNeedsRestart(german, (path) => path === german)).toBe(
				true
			);
			// Any other JSON file is still assumed to be read at startup.
			expect(changeNeedsRestart(other, () => false)).toBe(true);
		} finally {
			setI18nRouting(undefined);
			rmSync(root, { force: true, recursive: true });
		}
	});
});
