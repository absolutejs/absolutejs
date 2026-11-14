import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { handleAngularPageRequest } from '../../../src/angular';
import { deriveAngularBaseHref } from '../../../src/angular/baseHref';
import {
	compileAngular,
	detectAngularPageComponentClass
} from '../../../src/build/compileAngular';
import {
	absoluteRequestContext,
	getCurrentAbsoluteRoute
} from '../../../src/core/requestContext';

/* A router page that declares its routed children in the same file:
 *
 *   export class RoutedAComponent {}   // routed child
 *   export class RoutedBComponent {}   // routed child
 *   export const routes = [...]
 *   export class ColocatedRoutesPageComponent {}   // hosts <router-outlet>
 *
 * The build used to append `export default RoutedAComponent` (the first
 * exported class), so the server and the client bootstrap both rendered
 * the first routed child as the page root for every URL. */

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..');
const FIXTURE = join(
	REPO_ROOT,
	'tests',
	'fixtures',
	'angular',
	'colocated-routes-page.ts'
);
const COMPILE_TIMEOUT_MS = 120_000;

let projectRoot = '';
let pagesDir = '';
let pageSource = '';
type CompiledPage = { client: string; server: string; serverPath: string };

let aot: CompiledPage | null = null;
let jit: CompiledPage | null = null;

const compileIn = async (hmr: boolean) => {
	const originalCwd = process.cwd();
	process.chdir(projectRoot);
	try {
		const { clientPaths, serverPaths } = await compileAngular(
			[pageSource],
			pagesDir,
			hmr,
			undefined,
			{
				appProvidersSource: null,
				pagesByFile: new Map([
					[pageSource, { basePath: null, hasRoutes: true }]
				])
			}
		);
		const clientPath = clientPaths.find((path) =>
			path.endsWith('portal.js')
		);
		const serverPath = serverPaths.find((path) =>
			path.endsWith('portal.js')
		);
		if (!clientPath || !serverPath)
			throw new Error('compiled page outputs not found');

		return {
			client: await readFile(clientPath, 'utf-8'),
			server: await readFile(serverPath, 'utf-8'),
			serverPath
		};
	} finally {
		process.chdir(originalCwd);
	}
};

beforeAll(async () => {
	// realpath: the AOT compiler's rootDir is the (resolved) cwd.
	projectRoot = await realpath(
		await mkdtemp(join(tmpdir(), 'absolute-colocated-routes-'))
	);
	pagesDir = join(projectRoot, 'angular', 'pages');
	await mkdir(pagesDir, { recursive: true });
	await symlink(
		join(REPO_ROOT, 'node_modules'),
		join(projectRoot, 'node_modules'),
		'dir'
	);
	pageSource = join(pagesDir, 'portal.ts');
	await copyFile(FIXTURE, pageSource);
	aot = await compileIn(false);
	jit = await compileIn(true);
}, COMPILE_TIMEOUT_MS * 2);

afterAll(async () => {
	if (projectRoot) await rm(projectRoot, { force: true, recursive: true });
});

describe('detectAngularPageComponentClass', () => {
	test('picks the router-outlet host over co-located routed children (AOT output)', () => {
		const source = `
export class RoutedA {
    static ɵcmp = i0.ɵɵdefineComponent({ type: RoutedA, selectors: [["routed-a"]], template: function (rf) { i0.ɵɵtext(0, "A"); } });
}
export class RoutedB {
    static ɵcmp = i0.ɵɵdefineComponent({ type: RoutedB, selectors: [["routed-b"]], template: function (rf) { i0.ɵɵtext(0, "B"); } });
}
export const routes = [{ component: RoutedA, path: '' }, { component: RoutedB, path: 'b' }];
export class Shell {
    static ɵcmp = i0.ɵɵdefineComponent({ type: Shell, selectors: [["app-shell"]], template: function (rf) { i0.ɵɵelement(0, "router-outlet"); }, dependencies: [RouterOutlet] });
}
`;
		expect(detectAngularPageComponentClass(source)).toBe('Shell');
	});

	test('picks the router-outlet host in decorator (JIT) output', () => {
		const source = `
export class RoutedA {
}
RoutedA = __decorate([Component({ selector: "routed-a", template: "<p>A</p>" })], RoutedA);
export const routes = [{ component: RoutedA, path: '' }];
export class Shell {
}
Shell = __decorate([Component({ imports: [RouterOutlet], selector: "app-shell", template: "<router-outlet />" })], Shell);
`;
		expect(detectAngularPageComponentClass(source)).toBe('Shell');
	});

	test('picks the outermost host when a routed child has its own outlet', () => {
		const source = `
export class Child {}
Child = __decorate([Component({ selector: "x-child", template: "<p>c</p>" })], Child);
export class Section {}
Section = __decorate([Component({ imports: [RouterOutlet], selector: "x-section", template: "<router-outlet />" })], Section);
export const routes = [{ path: 's', component: Section, children: [{ path: '', component: Child }] }];
export class Shell {}
Shell = __decorate([Component({ imports: [RouterOutlet], selector: "x-shell", template: "<router-outlet />" })], Shell);
`;
		expect(detectAngularPageComponentClass(source)).toBe('Shell');
	});

	test('keeps an explicit default export', () => {
		expect(
			detectAngularPageComponentClass(
				'export class A {}\nexport class B {}\nexport default A;'
			)
		).toBe('A');
	});

	test('falls back to the last exported component without an outlet', () => {
		const source = `
export class Child {}
Child = __decorate([Component({ selector: "x-child", template: "<p>c</p>" })], Child);
export class Page {}
Page = __decorate([Component({ imports: [Child], selector: "x-page", template: "<x-child />" })], Page);
`;
		expect(detectAngularPageComponentClass(source)).toBe('Page');
	});

	test('handles a single exported class and pages with no class', () => {
		expect(
			detectAngularPageComponentClass('export class OnlyPage {}')
		).toBe('OnlyPage');
		expect(
			detectAngularPageComponentClass(
				'export const renderNotFound = () => "";'
			)
		).toBeNull();
	});
});

describe('compileAngular with co-located routed children', () => {
	test('AOT build points the default export and client bootstrap at the outlet host', () => {
		expect(aot?.server).toContain(
			'export default ColocatedRoutesPageComponent;'
		);
		expect(aot?.server).not.toContain('export default RoutedAComponent');
		expect(aot?.client).toContain(
			'var ColocatedRoutesPageComponent = pageModule.default;'
		);
		expect(aot?.client).toContain(
			'bootstrapApplication(ColocatedRoutesPageComponent'
		);
	});

	test('dev (JIT/HMR) build points the default export and client bootstrap at the outlet host', () => {
		expect(jit?.server).toContain(
			'export default ColocatedRoutesPageComponent;'
		);
		expect(jit?.client).toContain(
			'var ColocatedRoutesPageComponent = pageModule.default;'
		);
		expect(jit?.client).toContain(
			'bootstrapApplication(ColocatedRoutesPageComponent'
		);
	});

	test('client bootstrap applies the server-provided base href', () => {
		for (const output of [aot?.client, jit?.client]) {
			expect(output).toContain('window.__ABS_ANGULAR_BASE_HREF__');
			expect(output).toContain(
				'{ provide: __abs_APP_BASE_HREF, useValue: runtimeBaseHref }'
			);
		}
	});
});

describe('deriveAngularBaseHref', () => {
	test('derives the mount from wildcard routes', () => {
		expect(deriveAngularBaseHref('/portal/*', '/portal/b')).toBe(
			'/portal/'
		);
		expect(deriveAngularBaseHref('/a/b/*', '/a/b/c/d')).toBe('/a/b/');
		expect(deriveAngularBaseHref('/t/:tenant/*', '/t/acme/settings')).toBe(
			'/t/acme/'
		);
	});

	test('returns null when there is no base to set', () => {
		expect(deriveAngularBaseHref(undefined, '/x')).toBeNull();
		expect(deriveAngularBaseHref('/*', '/x')).toBeNull();
		expect(deriveAngularBaseHref('/portal/:id', '/portal/1')).toBeNull();
		expect(deriveAngularBaseHref('/t/:tenant/*', '/other')).toBeNull();
	});
});

describe('SSR of a compiled co-located router page', () => {
	/* The handler is called from a helper function, which the build-time
	 * `.get('/path/*', …)` scan can't see through. The base href now comes
	 * from the route Elysia matched at request time. */
	const renderPortal = () =>
		handleAngularPageRequest({
			headTag: '<head><title>Portal</title></head>',
			indexPath: '/angular/indexes/portal.js',
			pagePath: aot?.serverPath ?? ''
		});
	const app = () =>
		new Elysia()
			.use(absoluteRequestContext)
			.get('/route-probe/*', ({ request }) =>
				String(getCurrentAbsoluteRoute(request))
			)
			.get('/portal/*', () => renderPortal())
			.get('/', () => renderPortal());

	test('exposes the matched route pattern to the handler', async () => {
		const response = await app().handle(
			new Request('http://absolute.test/route-probe/x/y')
		);
		expect(await response.text()).toBe('/route-probe/*');
	});

	test(
		'renders the outlet host as the root and the routed child for each URL',
		async () => {
			const server = app();
			const rootHtml = await (
				await server.handle(new Request('http://absolute.test/portal/'))
			).text();
			const childHtml = await (
				await server.handle(
					new Request('http://absolute.test/portal/b')
				)
			).text();

			for (const html of [rootHtml, childHtml]) {
				expect(html).toContain('<colocated-routes-page');
				expect(html).not.toContain('<body><routed-a');
				expect(html).toContain(
					'window.__ABS_ANGULAR_BASE_HREF__ = "/portal/";'
				);
				expect(html).toContain('href="/portal/b"');
			}
			expect(rootHtml).toContain('<p id="routed-a">Routed A</p>');
			expect(rootHtml).not.toContain('id="routed-b"');
			expect(childHtml).toContain('<p id="routed-b">Routed B</p>');
			expect(childHtml).not.toContain('id="routed-a"');
		},
		COMPILE_TIMEOUT_MS
	);

	/* Elysia routes `//` to `/`, but the request URL keeps both slashes.
	 * The handler passed `//` on as the render URL, which platform-server
	 * parses as a protocol-relative URL (NG05701, a 500, in production
	 * builds of the Angular version it was reported against). The render
	 * URL is now `/`. */
	test(
		'renders a request for // as the root URL',
		async () => {
			const response = await app().handle(
				new Request('http://absolute.test//')
			);
			const html = await response.text();

			expect(response.status).toBe(200);
			expect(html).not.toContain('NG05701');
			expect(html).toContain('<p id="routed-a">Routed A</p>');
		},
		COMPILE_TIMEOUT_MS
	);
});
