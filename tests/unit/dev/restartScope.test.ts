import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { changeNeedsRestart } from '../../../src/dev/restartScope';

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
});
