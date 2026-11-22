import { afterAll, describe, expect, test } from 'bun:test';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCodemodPlan } from '../../../src/migrate/apply';
import { scanProject } from '../../../src/migrate/scan';

/* The writing edge. `migrate` reported and changed nothing; what matters
 * now is that what a preview showed is exactly what lands, and that the
 * imports it refuses to touch are still there afterwards. */

const roots: string[] = [];

const project = () => {
	const root = mkdtempSync(join(tmpdir(), 'absolute-migrate-'));
	roots.push(root);
	mkdirSync(join(root, 'app'), { recursive: true });
	writeFileSync(
		join(root, 'package.json'),
		JSON.stringify({ dependencies: { next: '15.1.0' }, name: 'fixture' })
	);
	writeFileSync(
		join(root, 'app', 'page.tsx'),
		"import Link from 'next/link';\nimport Head from 'next/head';\n\nexport const Page = () => <Link href=\"/a\">a</Link>;\n"
	);

	return root;
};

afterAll(() => {
	for (const root of roots) rmSync(root, { force: true, recursive: true });
});

describe('applyCodemodPlan', () => {
	test('writes exactly the text the plan previewed', () => {
		const root = project();
		const plan = scanProject(root);
		const [preview] = plan.codemods.mechanical;

		expect(preview).toBeDefined();
		const result = applyCodemodPlan(root, plan.codemods);

		expect(result.failed).toEqual([]);
		expect(result.applied.map((file) => file.path)).toEqual([
			'app/page.tsx'
		]);
		expect(readFileSync(join(root, 'app', 'page.tsx'), 'utf-8')).toBe(
			preview?.rewritten ?? ''
		);
	});

	/* The point of the mechanical/manual split: applying one must not
	 * disturb the other, or a project is left half-migrated with no record
	 * of which half. */
	test('leaves the imports it refuses to rewrite in place', () => {
		const root = project();
		applyCodemodPlan(root, scanProject(root).codemods);
		const after = readFileSync(join(root, 'app', 'page.tsx'), 'utf-8');

		expect(after).toContain("import Head from 'next/head';");
		expect(after).toContain(
			"import { Link } from '@absolutejs/absolute/react/components';"
		);
	});

	test('a second run has nothing left to do', () => {
		const root = project();
		applyCodemodPlan(root, scanProject(root).codemods);

		expect(scanProject(root).codemods.mechanical).toEqual([]);
	});

	/* One unwritable path must not abandon a half-applied migration, so a
	 * failure is reported rather than thrown. */
	test('reports a file it could not write instead of throwing', () => {
		const root = project();
		const plan = scanProject(root);
		const result = applyCodemodPlan(
			join(root, 'does', 'not', 'exist'),
			plan.codemods
		);

		expect(result.applied).toEqual([]);
		expect(result.failed.map((item) => item.path)).toEqual([
			'app/page.tsx'
		]);
	});
});
