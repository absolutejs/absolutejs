import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createModuleServer } from '../../../src/dev/moduleServer';

describe('createModuleServer import rewriting', () => {
	// Regression: the bare-specifier stub rewriter used a `[\s\S]+?` clause
	// between `import`/`export` and `from`. Because that spans newlines and
	// string literals, a top-level `export const ...` could lazily bridge
	// across transpiled JSX to a later ` from` appearing INSIDE a string
	// (here the JSX text "...unregister from"), then treat the following
	// `,\n  ` as a specifier and inject a bogus `/@stub/%2C%0A...`, corrupting
	// unrelated code and producing "Uncaught SyntaxError: Invalid or
	// unexpected token" in the browser.
	test('does not stub the word "from" inside JSX string children', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-import-rewrite-'));
		try {
			const component = join(root, 'Sample.tsx');
			await writeFile(
				component,
				[
					'export const Sample = ({ name }: { name: string }) => (',
					'\t<p>',
					"\t\tAre you sure you want to unregister from{' '}",
					'\t\t<strong>{name}</strong>?',
					'\t</p>',
					');'
				].join('\n')
			);

			const moduleServer = createModuleServer({
				projectRoot: root,
				vendorPaths: {}
			});

			const response = await moduleServer('/@src/Sample.tsx');
			expect(response?.status).toBe(200);
			const code = await response?.text();
			if (!code) {
				throw new Error('Expected module server response body');
			}

			// A real specifier never contains a comma or newline, so an
			// encoded comma/newline in a /@stub/ URL is the fingerprint of the
			// bug (the rewriter swallowing `,\n  ` between two string children).
			// (Legitimate stubs like `/@stub/react%2Fjsx-dev-runtime` are fine.)
			expect(code).not.toContain('%2C');
			expect(code).not.toContain('%0A');
			// The two adjacent string children survive intact.
			expect(code).toContain('"Are you sure you want to unregister from"');
			expect(code).toContain('" "');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
