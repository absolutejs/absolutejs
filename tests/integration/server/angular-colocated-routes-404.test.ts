import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	mkdir,
	mkdtemp,
	readdir,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../helpers/ports';

/* An Angular page with a colocated `export const routes = [...]` mounted
 * under a wildcard route (`/ng/*`). Its mount path is only known per
 * request, so unknown sub-paths never answered 404. The page handler now
 * matches the path below the mount against the page module's routes and
 * answers 404 like the other SPA hosts: the
 * not-found convention for page requests, Elysia's JSON 404 otherwise. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const component = (selector: string, marker: string, className: string) => `
@Component({
	selector: '${selector}',
	standalone: true,
	template: '<p>${marker}</p>'
})
export class ${className} {}
`;

const shell = (selector: string, className: string) => `
@Component({
	imports: [RouterOutlet],
	selector: '${selector}',
	standalone: true,
	template: '<main id="shell"><router-outlet /></main>'
})
export class ${className} {}
`;

const IMPORTS = `import { Component } from '@angular/core';
import { RouterOutlet, type Routes } from '@angular/router';
`;

const NG_PAGE = `${IMPORTS}
${component('ng-home', 'NG_HOME', 'NgHomeComponent')}
${component('ng-a', 'NG_A', 'NgAComponent')}
${component('ng-b', 'NG_B', 'NgBComponent')}
${component('ng-kid', 'NG_KID', 'NgKidComponent')}
export const routes: Routes = [
	{ component: NgHomeComponent, path: '' },
	{ component: NgAComponent, path: 'a' },
	{ component: NgBComponent, path: 'b/:id' },
	{ path: 'old', redirectTo: 'a' },
	{ children: [{ component: NgKidComponent, path: 'kid' }], path: 'parent' }
];
${shell('ng-page', 'NgPageComponent')}`;

const WILD_PAGE = `${IMPORTS}
${component('wild-a', 'WILD_A', 'WildAComponent')}
${component('wild-any', 'WILD_ANY', 'WildAnyComponent')}
export const routes: Routes = [
	{ component: WildAComponent, path: 'a' },
	{ component: WildAnyComponent, path: '**' }
];
${shell('wild-page', 'WildPageComponent')}`;

const LAZY_PAGE = `${IMPORTS}
${component('lazy-any', 'LAZY_ANY', 'LazyAnyComponent')}
export const routes: Routes = [
	{
		loadChildren: () =>
			Promise.resolve([{ component: LazyAnyComponent, path: '**' }]),
		path: 'lazy'
	}
];
${shell('lazy-page', 'LazyPageComponent')}`;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	angularDirectory: './angular',
	buildDirectory: './build',
	htmlDirectory: './html'
});
`,
	'angular/pages/lazy-page.ts': LAZY_PAGE,
	'angular/pages/ng-page.ts': NG_PAGE,
	'angular/pages/wild-page.ts': WILD_PAGE,
	'html/pages/not-found.html':
		'<!doctype html><html><body>HTML_NOT_FOUND</body></html>\n',
	'package.json': `{ "name": "angular-colocated-404-app", "private": true, "type": "module" }
`,
	'server.ts': `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleAngularPageRequest } from '@absolutejs/absolute/angular';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/ng/*', ({ request }) =>
		handleAngularPageRequest({
			indexPath: asset(manifest, 'NgPageIndex'),
			pagePath: asset(manifest, 'NgPage'),
			request
		})
	)
	.get('/wild/*', ({ request }) =>
		handleAngularPageRequest({
			indexPath: asset(manifest, 'WildPageIndex'),
			pagePath: asset(manifest, 'WildPage'),
			request
		})
	)
	.get('/lazy-page/*', ({ request }) =>
		handleAngularPageRequest({
			indexPath: asset(manifest, 'LazyPageIndex'),
			pagePath: asset(manifest, 'LazyPage'),
			request
		})
	)
	.use(networking);
`
};

/* Link every package from the repo's node_modules except
 * @absolutejs/absolute, which points at this checkout (its dist/). */
const linkNodeModules = async (projectRoot: string) => {
	const source = join(repoRoot, 'node_modules');
	const target = join(projectRoot, 'node_modules');
	await mkdir(join(target, '@absolutejs'), { recursive: true });
	const [entries, scoped] = await Promise.all([
		readdir(source),
		readdir(join(source, '@absolutejs'))
	]);
	await Promise.all([
		...entries
			.filter((name) => name !== '@absolutejs' && name !== '.bin')
			.map((name) => symlink(join(source, name), join(target, name))),
		...scoped
			.filter((name) => name !== 'absolute' && !name.startsWith('.'))
			.map((name) =>
				symlink(
					join(source, '@absolutejs', name),
					join(target, '@absolutejs', name)
				)
			),
		symlink(repoRoot, join(target, '@absolutejs', 'absolute'))
	]);
};

type Mode = 'dev' | 'start';
type Result = { body: string; status: number; type: string };
type RunningApp = {
	baseUrl: string;
	log: string[];
	root: string;
	server: ReturnType<typeof Bun.spawn>;
};

const collectOutput = async (
	stream: ReadableStream<Uint8Array>,
	log: string[]
) => {
	const decoder = new TextDecoder();
	for await (const chunk of stream) log.push(decoder.decode(chunk));
};

const startApp = async (mode: Mode) => {
	const root = await mkdtemp(join(tmpdir(), `absolute-ng-404-${mode}-`));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);
	const port = await getAvailablePort();
	const args =
		mode === 'dev'
			? ['bun', CLI_ENTRY, 'dev', 'server.ts']
			: [
					'bun',
					CLI_ENTRY,
					'start',
					'server.ts',
					'--outdir',
					'start-build'
				];
	const server = Bun.spawn(args, {
		cwd: root,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: mode === 'dev' ? 'development' : 'production',
			PORT: String(port),
			TELEMETRY_OFF: '1'
		},
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const app: RunningApp = {
		baseUrl: `http://localhost:${port}`,
		log: [],
		root,
		server
	};
	void collectOutput(server.stdout as ReadableStream<Uint8Array>, app.log);
	void collectOutput(server.stderr as ReadableStream<Uint8Array>, app.log);
	for (let attempt = 0; attempt < 480; attempt++) {
		if (server.exitCode !== null)
			throw new Error(
				`server exited with ${server.exitCode}: ${app.log.join('')}`
			);
		try {
			// Dev builds Angular pages on first request: wait for the page.
			const response = await fetch(`${app.baseUrl}/ng/a`);
			if (response.ok) return app;
		} catch {
			// not listening yet
		}
		await Bun.sleep(250);
	}
	throw new Error(`server did not start: ${app.log.join('')}`);
};

const PAGE_HEADERS: Record<string, string> = { accept: 'text/html' };
const JSON_HEADERS: Record<string, string> = { accept: 'application/json' };

const OK_PATHS = [
	'/ng',
	'/ng/',
	'/ng/a',
	'/ng/b/5',
	'/ng/old',
	'/ng/parent/kid',
	'/wild/a',
	'/wild/nope',
	'/wild/deep/er/path',
	'/lazy-page/lazy/anything',
	'/lazy-page/lazy/deep/er'
];
const MISSING_PATHS = [
	'/ng/nope',
	'/ng/b',
	'/ng/parent/x',
	'/ng/a/extra',
	'/lazy-page/other'
];

const describeMode = (mode: Mode) =>
	describe(`absolute ${mode}: Angular colocated routes answer 404`, () => {
		let app: RunningApp | undefined;
		const results = new Map<string, Result>();
		const key = (path: string, kind: 'json' | 'page') => `${kind} ${path}`;

		beforeAll(async () => {
			await ensureDistBuild();
			app = await startApp(mode);
			const fetchResult = async (
				path: string,
				headers: Record<string, string>
			) => {
				const response = await fetch(`${app?.baseUrl}${path}`, {
					headers,
					redirect: 'manual'
				});

				return {
					body: await response.text(),
					status: response.status,
					type: response.headers.get('content-type') ?? ''
				};
			};
			// Sequential: dev builds each page on its first request.
			for (const path of [...OK_PATHS, ...MISSING_PATHS]) {
				results.set(
					key(path, 'page'),
					await fetchResult(path, PAGE_HEADERS)
				);
				results.set(
					key(path, 'json'),
					await fetchResult(path, JSON_HEADERS)
				);
			}
		}, 600_000);

		afterAll(async () => {
			if (!app) return;
			app.server.kill();
			await app.server.exited;
			await rm(app.root, { force: true, recursive: true });
		});

		test('matched sub-paths render the page', () => {
			const statuses = OK_PATHS.map((path) => [
				path,
				results.get(key(path, 'page'))?.status
			]);
			expect(statuses).toEqual(OK_PATHS.map((path) => [path, 200]));
			expect(results.get(key('/ng/a', 'page'))?.body).toContain('NG_A');
			expect(results.get(key('/ng/b/5', 'page'))?.body).toContain('NG_B');
			expect(results.get(key('/ng/parent/kid', 'page'))?.body).toContain(
				'NG_KID'
			);
			expect(results.get(key('/wild/nope', 'page'))?.body).toContain(
				'WILD_ANY'
			);
			expect(
				results.get(key('/lazy-page/lazy/anything', 'page'))?.body
			).toContain('LAZY_ANY');
		});

		test('unmatched sub-paths get the not-found page with status 404', () => {
			for (const path of MISSING_PATHS) {
				const result = results.get(key(path, 'page'));
				expect([path, result?.status]).toEqual([path, 404]);
				expect(result?.body).toContain('HTML_NOT_FOUND');
				expect(result?.body).not.toContain('id="shell"');
			}
		});

		test('JSON clients get a JSON 404 for unmatched sub-paths', () => {
			for (const path of MISSING_PATHS) {
				const result = results.get(key(path, 'json'));
				expect([path, result?.status]).toEqual([path, 404]);
				expect(result?.type).toContain('json');
				expect(result?.body).not.toContain('HTML_NOT_FOUND');
				expect(JSON.parse(result?.body ?? '')).toMatchObject({
					status: 404
				});
			}
		});
	});

describeMode('start');
describeMode('dev');
