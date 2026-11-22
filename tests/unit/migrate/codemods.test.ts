import { describe, expect, test } from 'bun:test';
import {
	MANUAL_CODEMODS,
	MECHANICAL_CODEMODS,
	planCodemods,
	rewriteSource,
	type SourceFile
} from '../../../src/migrate/codemods';

/* `absolute migrate` used to report third-party dependencies only. On a
 * four-file Next.js app it listed six dependency swaps and said nothing
 * about the eight `next/*` imports in the source — the framework the
 * project is actually leaving. These tests pin both halves of the fix: the
 * import rewrites it now makes, and the ones it must refuse to make. */

describe('rewriteSource', () => {
	test('turns a default import into the named one and keeps the module', () => {
		const result = rewriteSource(
			'import Image from \'next/image\';\nexport const A = () => <Image src="/a.png" alt="a" />;\n'
		);

		expect(result.changed).toBe(true);
		expect(result.source).toContain(
			"import { Image } from '@absolutejs/absolute/react/components';"
		);
		expect(result.source).not.toContain('next/image');
		expect(result.source).toContain('<Image src="/a.png" alt="a" />');
	});

	/* The local name is the one the rest of the file calls, so renaming it
	 * would break every call site the codemod did not look at. */
	test('preserves a renamed local binding with an alias', () => {
		const result = rewriteSource("import NextLink from 'next/link';\n");

		expect(result.source).toContain(
			"import { Link as NextLink } from '@absolutejs/absolute/react/components';"
		);
	});

	/* Two rules share one target module. Emitting two import statements
	 * from the same module is legal but trips `no-duplicate-imports` in the
	 * project being migrated, so they are merged. */
	test('merges several rewrites from one module into a single import', () => {
		const result = rewriteSource(
			"import Link from 'next/link';\nimport Image from 'next/image';\nconst x = 1;\n"
		);

		const statements = result.source
			.split('\n')
			.filter((line) => line.startsWith('import '));

		expect(statements).toEqual([
			"import { Image, Link } from '@absolutejs/absolute/react/components';"
		]);
		expect(result.source).toContain('const x = 1;');
	});

	test('leaves a file with nothing to rewrite byte-identical', () => {
		const source = "import { useState } from 'react';\n";
		const result = rewriteSource(source);

		expect(result.changed).toBe(false);
		expect(result.source).toBe(source);
	});

	/* `import * as` and side-effect imports are not matched on purpose: a
	 * namespace binding is used as `ns.default`, which the named export is
	 * not. Guessing here would produce code that type-checks and breaks. */
	test('does not touch a namespace import', () => {
		const source = "import * as img from 'next/image';\n";

		expect(rewriteSource(source).changed).toBe(false);
	});

	test('reports named imports it could not carry over', () => {
		const result = rewriteSource(
			"import Link, { LinkProps } from 'next/link';\n"
		);

		expect(result.changed).toBe(true);
		expect(result.notes.join(' ')).toContain('LinkProps');
	});

	/* Only the first import of a module is rewritten. That is acceptable —
	 * two imports of one module in one file is a mistake already — but it
	 * must not be reported as finished. */
	test('says so when a module is still imported after the rewrite', () => {
		const result = rewriteSource(
			"import Link from 'next/link';\nimport Other from 'next/link';\n"
		);

		expect(result.source).toContain("from 'next/link'");
		expect(result.notes.join(' ')).toContain('only the first import');
	});

	test('carries the prop differences a person still has to check', () => {
		const result = rewriteSource("import Link from 'next/link';\n");

		expect(result.notes.join(' ')).toContain('prefetch');
		expect(result.notes.join(' ')).toContain('legacyBehavior');
	});
});

describe('planCodemods', () => {
	const files: SourceFile[] = [
		{
			path: 'app/page.tsx',
			text: "import Link from 'next/link';\nimport Head from 'next/head';\n"
		},
		{
			path: 'app/admin.tsx',
			text: "import { useRouter } from 'next/navigation';\n"
		},
		{ path: 'lib/plain.ts', text: 'export const two = 2;\n' }
	];

	test('separates what it can rewrite from what it cannot', () => {
		const plan = planCodemods({ files });

		expect(plan.mechanical.map((edit) => edit.path)).toEqual([
			'app/page.tsx'
		]);
		expect(plan.manual.map((item) => item.rule.from).sort()).toEqual([
			'next/head',
			'next/navigation'
		]);
	});

	test('locates each manual import so a person knows where to go', () => {
		const plan = planCodemods({ files });
		const head = plan.manual.find((item) => item.rule.from === 'next/head');

		expect(head?.files).toEqual(['app/page.tsx']);
	});

	/* `'next/head'` is a prefix of `'next/headers'`. A substring test
	 * without the closing quote reports one as the other. */
	test('does not confuse next/head with next/headers', () => {
		const plan = planCodemods({
			files: [
				{
					path: 'a.ts',
					text: "import { cookies } from 'next/headers';\n"
				}
			]
		});

		expect(plan.manual.map((item) => item.rule.from)).toEqual([
			'next/headers'
		]);
	});

	/* `next/font/google` and `next/font/local` are both the same advice. */
	test('matches a module family by prefix', () => {
		const plan = planCodemods({
			files: [
				{
					path: 'a.ts',
					text: "import { Inter } from 'next/font/google';\n"
				}
			]
		});

		expect(plan.manual.map((item) => item.rule.from)).toEqual([
			'next/font'
		]);
	});

	test('a project with no framework imports plans nothing', () => {
		const plan = planCodemods({
			files: [files[2] ?? { path: '', text: '' }]
		});

		expect(plan).toEqual({ manual: [], mechanical: [] });
	});
});

describe('the rule tables', () => {
	/* A rule naming a module that does not exist on this side would send
	 * someone to a broken import, which is worse than no advice. These are
	 * the two subpaths in `package.json#exports` the rules point at. */
	test('every mechanical rule targets a real published subpath', () => {
		for (const rule of MECHANICAL_CODEMODS)
			expect(rule.to).toBe('@absolutejs/absolute/react/components');
	});

	test('every rule explains itself', () => {
		for (const rule of MECHANICAL_CODEMODS) {
			expect(rule.because.length).toBeGreaterThan(0);
			expect(rule.notes.length).toBeGreaterThan(0);
		}
		for (const rule of MANUAL_CODEMODS) {
			expect(rule.reason.length).toBeGreaterThan(0);
			expect(rule.instruction.length).toBeGreaterThan(0);
		}
	});

	/* A module cannot be both rewritten and refused. */
	test('no module appears in both tables', () => {
		const mechanical = new Set(
			MECHANICAL_CODEMODS.map((rule) => rule.from)
		);
		for (const rule of MANUAL_CODEMODS)
			expect(mechanical.has(rule.from)).toBe(false);
	});
});
