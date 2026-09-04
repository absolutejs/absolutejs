import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import { serverEntryPaths } from '../../../src/cli/scripts/typecheck';
import {
	deferrableEntryImports,
	formatImportAdvice,
	summarizeImportAdvice
} from '../../../src/dev/importCost/advice';

const root = mkdtempSync(join(tmpdir(), 'absolute-import-advice-'));

const writeEntry = (relativePath: string, source: string) => {
	const path = join(root, relativePath);
	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(path, source);

	return path;
};

afterAll(() => rmSync(root, { force: true, recursive: true }));

describe('serverEntryPaths', () => {
	const defaultEntry = writeEntry(
		'app/src/backend/server.ts',
		'export {};\n'
	);
	const namedEntry = writeEntry('app/src/other.ts', 'export {};\n');

	test('falls back to the default entry for a service that names none', () => {
		expect(serverEntryPaths([{ cwd: join(root, 'app') }])).toEqual([
			defaultEntry
		]);
	});

	test('honours an explicit entry', () => {
		expect(
			serverEntryPaths([
				{ cwd: join(root, 'app'), entry: 'src/other.ts' }
			])
		).toEqual([namedEntry]);
	});

	test('deduplicates services that share an entry', () => {
		expect(
			serverEntryPaths([
				{ cwd: join(root, 'app') },
				{ cwd: join(root, 'app'), entry: 'src/backend/server.ts' }
			])
		).toEqual([defaultEntry]);
	});

	test('skips a project with no server entry on disk', () => {
		// `absolute typecheck` also runs in plain TypeScript libraries.
		expect(serverEntryPaths([{ cwd: join(root, 'library') }])).toEqual([]);
	});
});

const ENTRY_SOURCE = `
import "reflect-metadata";
import { makeApp } from './app';
import { handler } from './handler';
import type { Thing } from './thing';

export const app = makeApp();
export const route = () => handler({} as Thing);
`;

describe('deferrableEntryImports', () => {
	test('keeps only what is deferrable in shape', () => {
		expect(
			deferrableEntryImports(ENTRY_SOURCE, '/app/server.ts').map(
				(entry) => entry.specifier
			)
		).toEqual(['./handler']);
	});

	test('leaves type-only imports out — they never load', () => {
		expect(
			deferrableEntryImports(ENTRY_SOURCE, '/app/server.ts').map(
				(entry) => entry.specifier
			)
		).not.toContain('./thing');
	});
});

describe('the advice it prints', () => {
	const entries = deferrableEntryImports(ENTRY_SOURCE, '/app/server.ts');

	test('says nothing at all when there is nothing to say', () => {
		expect(summarizeImportAdvice([], 'src/backend/server.ts')).toBeNull();
	});

	test('the unasked-for summary is short and points at the measurement', () => {
		const summary = summarizeImportAdvice(entries, 'src/backend/server.ts');

		expect(summary).not.toBeNull();
		expect(summary?.split('\n')).toHaveLength(2);
		expect(summary).toContain('src/backend/server.ts');
		expect(summary).toContain('ABSOLUTE_DEV_IMPORT_COST=1');
		expect(summary).toContain('--import-advice');
	});

	test('the listing names each import and its line', () => {
		const listing = formatImportAdvice(entries, 'src/backend/server.ts');

		expect(listing).toContain('./handler');
		expect(listing).toContain('4');
	});

	test('the listing says it reports shape, not cost, and does not fail', () => {
		const listing = formatImportAdvice(entries, 'src/backend/server.ts');

		expect(listing).toContain('shape, not cost');
		expect(listing).toContain('ABSOLUTE_DEV_IMPORT_COST=1');
		expect(listing).toContain('exit code is unaffected');
	});

	test('claims no saving anywhere', () => {
		const listing = formatImportAdvice(entries, 'src/backend/server.ts');

		expect(listing).not.toContain('save');
		expect(listing).not.toContain('faster');
	});

	test('an entry with nothing deferrable says so rather than staying silent', () => {
		expect(formatImportAdvice([], 'src/backend/server.ts')).toContain(
			'no top-level import'
		);
	});
});
