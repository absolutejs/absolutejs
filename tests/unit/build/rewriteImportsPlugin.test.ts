import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	jsRewriteImports,
	rewriteImportsInContent,
	fixMissingReExportNamespacesInContent,
	rewriteVendorDirectories
} from '../../../src/build/rewriteImportsPlugin';

const tempRoots = new Set<string>();

const makeTempDir = async () => {
	const dir = await mkdtemp(join(tmpdir(), 'rewrite-imports-plugin-'));
	tempRoots.add(dir);

	return dir;
};

afterEach(async () => {
	for (const dir of [...tempRoots]) {
		await rm(dir, { force: true, recursive: true }).catch(() => {});
		tempRoots.delete(dir);
	}
});

describe('rewriteImportsPlugin', () => {
	test('rewrites bare specifier `from "rxjs"` to vendor URL', () => {
		const input = `import { of } from "rxjs";\nconst x = of(1);\n`;
		const output = rewriteImportsInContent(input, {
			rxjs: '/vendor/rxjs.js'
		});
		expect(output).toContain('from "/vendor/rxjs.js"');
		expect(output).not.toContain('from "rxjs"');
	});

	test('rewrites side-effect and dynamic imports too', () => {
		const input = [
			'import "rxjs/operators";',
			'const mod = await import("rxjs");',
			'export { x } from "rxjs/internal/util";'
		].join('\n');

		const output = jsRewriteImports(input, [
			['rxjs/operators', '/vendor/rxjs_operators.js'],
			['rxjs/internal/util', '/vendor/rxjs_internal_util.js'],
			['rxjs', '/vendor/rxjs.js']
		]);

		expect(output).toContain('import "/vendor/rxjs_operators.js"');
		expect(output).toContain('import("/vendor/rxjs.js")');
		expect(output).toContain('from "/vendor/rxjs_internal_util.js"');
	});

	test('longer specifiers replaced before their prefixes', () => {
		// Without length-sorted replacements, `@angular/core/rxjs-interop`
		// would get partially rewritten because `@angular/core` matches
		// first. The plugin sorts internally.
		const input = `import { x } from "@angular/core/rxjs-interop";\n`;
		const output = rewriteImportsInContent(input, {
			'@angular/core': '/vendor/angular_core.js',
			'@angular/core/rxjs-interop':
				'/vendor/angular_core_rxjs-interop.js'
		});

		expect(output).toContain(
			'from "/vendor/angular_core_rxjs-interop.js"'
		);
		expect(output).not.toContain('from "@angular/core/rxjs-interop"');
	});

	test('rewriteVendorDirectories tolerates ENOENT race', async () => {
		const dir = await makeTempDir();

		// Vendor file with a bare specifier that needs rewriting.
		const vendorFile = join(dir, 'sentry_angular.js');
		await writeFile(
			vendorFile,
			`import { Component } from "@angular/core";\nexport { Component };\n`
		);

		// Add a bogus path that doesn't exist; the rewriter should swallow
		// the ENOENT (mid-build sweep race) instead of throwing.
		await rewriteVendorDirectories([dir, join(dir, 'missing-dir')], {
			'@angular/core': '/vendor/angular_core.js'
		});

		const rewritten = await readFile(vendorFile, 'utf-8');
		expect(rewritten).toContain('from "/vendor/angular_core.js"');
		expect(rewritten).not.toContain('from "@angular/core"');
	});

	test('fixMissingReExportNamespacesInContent injects missing import * as', () => {
		// Simulate Bun's bundler bug: `__reExport(exports_x, core)`
		// without a matching `import * as core from "..."`. The heuristic
		// matches the ident against the import-source basename's tail
		// (e.g. `angular_core` → `core`).
		const input = [
			'import { Component } from "/vendor/angular_core.js";',
			'__reExport(exports_x, core);',
			'export { Component };'
		].join('\n');

		const output = fixMissingReExportNamespacesInContent(input);
		expect(output).toContain(
			'import * as core from "/vendor/angular_core.js"'
		);
		expect(output).toContain('__reExport(exports_x, core)');
	});

	test('fixMissingReExportNamespacesInContent leaves content alone when ident is already imported', () => {
		const input = [
			'import * as core from "/vendor/angular_core.js";',
			'__reExport(exports_x, core);'
		].join('\n');
		const output = fixMissingReExportNamespacesInContent(input);
		expect(output).toBe(input);
	});
});
