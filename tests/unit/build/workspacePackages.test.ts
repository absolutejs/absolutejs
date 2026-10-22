import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	isWorkspacePackageSpecifier,
	workspacePackageDirs
} from '../../../src/build/workspacePackages';

/* A workspace as Bun lays it out: the app's node_modules links the shared
 * package straight to its source folder, beside a regular installed one. */
const root = realpathSync(mkdtempSync(join(tmpdir(), 'abs-workspace-')));
const app = join(root, 'web');
const shared = join(root, 'core');
const writeJson = (path: string, value: unknown) =>
	writeFileSync(path, JSON.stringify(value));

mkdirSync(join(app, 'node_modules', '@demo'), { recursive: true });
mkdirSync(join(app, 'node_modules', 'library'), { recursive: true });
mkdirSync(shared, { recursive: true });
writeJson(join(shared, 'package.json'), {
	exports: { './*': './*.ts' },
	name: '@demo/core',
	type: 'module'
});
writeFileSync(join(shared, 'greeting.ts'), 'export const greet = () => 1;\n');
symlinkSync(shared, join(app, 'node_modules', '@demo', 'core'));
writeJson(join(app, 'node_modules', 'library', 'package.json'), {
	main: 'index.js',
	name: 'library'
});
writeFileSync(join(app, 'node_modules', 'library', 'index.js'), 'module.exports = 1;\n');
writeJson(join(app, 'package.json'), {
	dependencies: { '@demo/core': 'workspace:*', library: '1.0.0', missing: '1.0.0' },
	name: 'web'
});

afterAll(() => rmSync(root, { force: true, recursive: true }));

describe('the app\'s own workspace packages', () => {
	test('a linked package is the app\'s source; an installed one is not', () => {
		expect(isWorkspacePackageSpecifier('@demo/core/greeting', app)).toBe(true);
		expect(isWorkspacePackageSpecifier('library', app)).toBe(false);
		expect(isWorkspacePackageSpecifier('not-installed', app)).toBe(false);
	});

	test('their folders are watched; installed and missing ones are not', () => {
		expect(workspacePackageDirs(app)).toEqual([shared]);
	});

	test('an app with no readable package.json has none', () => {
		expect(workspacePackageDirs(join(root, 'nowhere'))).toEqual([]);
	});
});
