import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import {
	compileAngular,
	detectAngularPageComponentClass
} from '../../../src/build/compileAngular';

/* Dev compiles Angular with JIT and production with AOT, and that split
 * is load-bearing rather than an oversight. Measured on this repository:
 *
 *   per edit, 5 components     AOT 515 ms   JIT 1 ms
 *   per edit, 25 components    AOT 637 ms   JIT 3 ms
 *   per edit, 50 components    AOT 743 ms   JIT 4 ms
 *
 * AOT has no per-file path — it compiles a PROGRAM — so an edit re-runs
 * the Angular compiler over the page's whole graph. The dev tick today is
 * 8-56 ms of server work plus 5-13 ms to apply in the browser, through
 * `compileAngularFileJIT`; under AOT it would be half a second or more,
 * and the per-component remount path would be gone with it.
 *
 * The cost of the split is that a bug can live in one compiler and not
 * the other, and nothing noticed. This is that seam: the two outputs are
 * different code by design — JIT keeps `@Component` decorators, AOT emits
 * `ɵcmp` — so these assert the things a PAGE depends on rather than the
 * text. The page-root choice is the one that matters most: picking the
 * wrong class there renders the wrong component, and a change to the
 * compiler's output shape can silently move it. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const roots: string[] = [];

const PAGE = `import { Component } from '@angular/core';
import { RouterLink, RouterOutlet, type Routes } from '@angular/router';

@Component({
	selector: 'parity-child',
	standalone: true,
	template: '<p id="child">child</p>'
})
export class ParityChildComponent {}

export const routes: Routes = [
	{ component: ParityChildComponent, path: '' }
];

@Component({
	imports: [RouterLink, RouterOutlet],
	selector: 'parity-page',
	standalone: true,
	template: \`<main>
	<router-outlet />
	@defer (on timer(120ms)) {
		<p id="late">late</p>
	} @placeholder {
		<p id="soon">soon</p>
	}
</main>\`
})
export class ParityPageComponent {}
`;

/* Inside the repository, dot-prefixed so the dev watcher ignores it: a
 * directory under the OS temp root resolves its own copy of `@angular/*`,
 * and a second Angular instance has no compiler facade. */
const compile = async (hmr: boolean) => {
	const root = await mkdtemp(join(repoRoot, '.ng-parity-'));
	roots.push(root);
	const pagesDir = join(root, 'pages');
	await mkdir(pagesDir, { recursive: true });
	const pageSource = join(pagesDir, 'parity.ts');
	await writeFile(pageSource, PAGE);

	const { serverPaths } = await compileAngular(
		[pageSource],
		root,
		hmr,
		undefined,
		{
			appProvidersSource: null,
			pagesByFile: new Map([
				[pageSource, { basePath: null, hasRoutes: true }]
			])
		}
	);
	const serverPath = serverPaths.find((path) => path.endsWith('parity.js'));
	if (serverPath === undefined)
		throw new Error(
			`no server output: ${serverPaths.join(', ') || '(none)'}`
		);

	return readFile(serverPath, 'utf-8');
};

let jit = '';
let aot = '';

afterAll(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('what dev and production must agree on', () => {
	test('compiles the same page both ways', async () => {
		[jit, aot] = await Promise.all([compile(true), compile(false)]);

		expect(jit.length).toBeGreaterThan(0);
		expect(aot.length).toBeGreaterThan(0);
	}, 240_000);

	/* The one that renders the wrong component when it breaks. A page
	 * declaring its routed children in the same file exports several
	 * components, and the page root is the one hosting `<router-outlet>`
	 * — not the first or the last declared. The picker reads the
	 * compiled output, so a change to either compiler's shape can move
	 * its answer without any test noticing. */
	test('the page root is the same class in both', () => {
		expect(detectAngularPageComponentClass(jit)).toBe(
			'ParityPageComponent'
		);
		expect(detectAngularPageComponentClass(aot)).toBe(
			'ParityPageComponent'
		);
	});

	test('both export the page and its routed child', () => {
		for (const output of [jit, aot]) {
			expect(output).toContain('ParityPageComponent');
			expect(output).toContain('ParityChildComponent');
			expect(output).toContain('routes');
		}
	});

	/* The router the build injects is what makes a routed page work at
	 * all, and it is appended to the compiled text — so it has to survive
	 * both compilers' output shapes. */
	test('both carry the injected router with the same features', () => {
		for (const output of [jit, aot]) {
			expect(output).toContain('__abs_provideRouter(routes');
			expect(output).toContain('__abs_withComponentInputBinding()');
			expect(output).toContain('__abs_withViewTransitions()');
			expect(output).toContain('withInMemoryScrolling');
		}
	});

	/* `@defer` surprised the first version of this file, which asserted
	 * that both paths lower it through this framework's own
	 * `lowerAngularDeferSyntax`. NEITHER does, here: both leave the block
	 * for Angular, and Angular handles it at different times — AOT
	 * compiles the template at build time, JIT keeps the decorator and
	 * lets Angular's runtime compiler read it. The framework's lowering
	 * serves other flows, such as partial prerendering.
	 *
	 * So the parity worth asserting is that one path does not start
	 * lowering while the other does not: a `@defer` that streamed through
	 * a slot in production and ran as a native Angular block in dev would
	 * be a divergence nobody would find by reading. */
	test('both leave @defer to Angular rather than lowering it', () => {
		for (const output of [jit, aot]) {
			expect(output).toContain('@defer');
			expect(output).not.toContain('angular-defer');
		}
	});

	/* And Angular compiles it at build time only in the AOT output — the
	 * dev page carries the template for the runtime compiler instead.
	 * That is the split itself, visible in one assertion. */
	test('only the production output has it compiled', () => {
		expect(aot).toMatch(/ɵɵdefer|ɵɵtemplate\(/u);
		expect(jit).not.toMatch(/ɵɵdefer/u);
	});

	/* The two are NOT the same code, and should not be asserted to be:
	 * JIT keeps the decorator for Angular to read at runtime, AOT emits
	 * the compiled definition. This pins that difference so the test
	 * above cannot be "fixed" by making one path imitate the other. */
	test('they differ the way they are meant to', () => {
		expect(aot).toContain('ɵcmp');
		expect(jit).not.toContain('ɵcmp');
	});
});
