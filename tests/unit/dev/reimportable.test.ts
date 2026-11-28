import { describe, expect, test } from 'bun:test';
import { isScriptModule, reimportableFiles } from '../../../src/dev/reimportable';

describe('what a hot update re-imports', () => {
	test('script modules only', () => {
		for (const file of ['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'a.mts', 'a.cts'])
			expect(isScriptModule(file)).toBe(true);
		for (const file of ['seti.woff', 'LICENSE.md', 'NOTICE.txt', 'theme.json', 'logo.svg'])
			expect(isScriptModule(file)).toBe(false);
	});

	test('a font or a license nothing imports is not re-imported; a JSON file updates through its importers', () => {
		const importers: Record<string, string[]> = {
			'/p/src/theme.json': ['/p/src/useTheme.ts', '/p/src/notes.md']
		};
		const files = reimportableFiles(
			['/p/src/Page.tsx', '/p/src/seti.woff', '/p/src/LICENSE.md', '/p/src/theme.json', '/p/src/Gone.tsx'],
			(file) => importers[file] ?? [],
			(file) => file !== '/p/src/Gone.tsx'
		);
		expect(files).toEqual(['/p/src/Page.tsx', '/p/src/useTheme.ts']);
	});
});
