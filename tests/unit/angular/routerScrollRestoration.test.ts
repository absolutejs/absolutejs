import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import type { AngularRouterConfig } from '../../../types/build';
import { compileAngular } from '../../../src/build/compileAngular';

/* Angular's router restores no scroll position and ignores a `#fragment`
 * unless it is told to, so an in-page navigation landed wherever the
 * previous view happened to be scrolled to.
 *
 * Measured in a browser on a routed page, before: scroll to 1500,
 * navigate, go back — scroll position 0. After: 1500. This framework's
 * own cross-framework navigation layer has always restored scroll, which
 * made Angular pages the odd ones out inside the same app. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const roots: string[] = [];

const PAGE = `import { Component } from '@angular/core';
import type { Routes } from '@angular/router';

@Component({
	selector: 'scroll-page',
	standalone: true,
	template: '<h1>Scroll</h1>'
})
export class ScrollPageComponent {}

export const routes: Routes = [];
`;

/* Inside the repository, dot-prefixed so the dev watcher ignores it: a
 * directory under the OS temp root resolves its own copy of `@angular/*`,
 * and a second Angular instance has no compiler facade. */
const compile = async (router?: AngularRouterConfig) => {
	const root = await mkdtemp(join(repoRoot, '.ng-router-scroll-'));
	roots.push(root);
	const pagesDir = join(root, 'pages');
	await mkdir(pagesDir, { recursive: true });
	const pageSource = join(pagesDir, 'scroll.ts');
	await writeFile(pageSource, PAGE);

	const { serverPaths } = await compileAngular(
		[pageSource],
		pagesDir,
		false,
		undefined,
		{
			appProvidersSource: null,
			pagesByFile: new Map([
				[pageSource, { basePath: null, hasRoutes: true }]
			]),
			...(router === undefined ? {} : { router })
		}
	);
	const serverPath = serverPaths.find((path) => path.endsWith('scroll.js'));
	if (serverPath === undefined)
		throw new Error('compileAngular produced no server output');

	return readFile(serverPath, 'utf-8');
};

afterAll(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('the injected router', () => {
	test('restores scroll and honours a fragment by default', async () => {
		const compiled = await compile();

		expect(compiled).toContain('withInMemoryScrolling');
		expect(compiled).toContain('scrollPositionRestoration: "enabled"');
		expect(compiled).toContain('anchorScrolling: "enabled"');
	}, 180_000);

	/* Opt-out exists because an app doing its own scroll management
	 * should be able to say so rather than fighting the router. */
	test('an app can turn it off', async () => {
		const compiled = await compile({ scrollRestoration: false });

		expect(compiled).not.toContain('withInMemoryScrolling');
		expect(compiled).toContain('__abs_provideRouter(routes');
	}, 180_000);

	/* Preloading every lazy route spends bandwidth a visitor may never
	 * use, so it is the one of the two that stays opt-IN. */
	test('preloading is off unless asked for', async () => {
		const compiled = await compile();

		expect(compiled).not.toContain('withPreloading');
		expect(compiled).not.toContain('PreloadAllModules');
	}, 180_000);

	test('preloading all routes when asked', async () => {
		const compiled = await compile({ preloading: 'all' });

		expect(compiled).toContain('withPreloading');
		expect(compiled).toContain('PreloadAllModules');
	}, 180_000);

	/* The features the page already had must survive being joined with
	 * the new ones. */
	test('the existing features are still there', async () => {
		const compiled = await compile();

		expect(compiled).toContain('__abs_withComponentInputBinding()');
		expect(compiled).toContain('__abs_withViewTransitions()');
		expect(compiled).toContain('__abs_withNavigationErrorHandler');
	}, 180_000);
});
