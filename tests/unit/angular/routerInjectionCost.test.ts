import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import { compileAngular } from '../../../src/build/compileAngular';

/* `provideRouter` is injected into a page's compiled server output only
 * when that page exports `routes`, and that condition is worth money.
 *
 * Measured against this repository's own Angular, bare — Angular's
 * `bootstrapApplication` + `renderApplication`, no AbsoluteJS code:
 *
 *   server + zoneless only          1.285 ms per render
 *   + provideRouter (10 routes)     1.469 ms   (+0.184 ms, 14%)
 *   + 40 more value providers       1.469 ms   (no measurable cost)
 *
 * So the router is the one provider that moves the number, and 40
 * ordinary DI tokens do not. A page that declares no routes would pay
 * 14% of its render time for a router it never uses.
 *
 * The existing HMR test (`angular-config-providers`) asserts the positive
 * direction: adding `export const routes` injects the router. Nothing
 * asserted the negative one, so making the injection unconditional —
 * a plausible simplification, since it would remove a branch — would
 * silently cost every Angular page 14% with no test failing. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const roots: string[] = [];

const PAGE = `import { Component } from '@angular/core';

@Component({
	selector: 'cost-page',
	standalone: true,
	template: '<h1>Cost</h1>'
})
export class CostPageComponent {}
`;

const ROUTES = `
import type { Routes } from '@angular/router';

export const routes: Routes = [];
`;

/* Inside the repository, dot-prefixed so the dev watcher ignores it: a
 * directory under the OS temp root resolves its own copy of `@angular/*`
 * from Bun's install cache, and a second Angular instance has no
 * compiler facade — which is exactly how an earlier version of this
 * measurement failed. */
const compile = async (withRoutes: boolean) => {
	const root = await mkdtemp(join(repoRoot, '.ng-router-cost-'));
	roots.push(root);
	const pagesDir = join(root, 'pages');
	await mkdir(pagesDir, { recursive: true });
	const pageSource = join(pagesDir, 'cost.ts');
	await writeFile(pageSource, withRoutes ? `${PAGE}${ROUTES}` : PAGE);

	const { serverPaths } = await compileAngular(
		[pageSource],
		pagesDir,
		false,
		undefined,
		{
			appProvidersSource: null,
			pagesByFile: new Map([
				[pageSource, { basePath: null, hasRoutes: withRoutes }]
			])
		}
	);
	const serverPath = serverPaths.find((path) => path.endsWith('cost.js'));
	if (serverPath === undefined)
		throw new Error(
			`compileAngular produced no server output for cost.ts: ${serverPaths.join(', ')}`
		);

	return readFile(serverPath, 'utf-8');
};

afterAll(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('provideRouter injection', () => {
	/* The control. Without it the absence assertion below passes even if
	 * injection were broken outright. */
	test('a page that exports routes gets provideRouter', async () => {
		const compiled = await compile(true);

		expect(compiled).toContain(
			'import { provideRouter as __abs_provideRouter'
		);
		expect(compiled).toContain('__abs_provideRouter(routes');
	}, 180_000);

	/* The 14% this test exists to protect. */
	test('a page with no routes gets no router at all', async () => {
		const compiled = await compile(false);

		expect(compiled).not.toContain('__abs_provideRouter');
		expect(compiled).not.toContain('@angular/router');
	}, 180_000);
});
