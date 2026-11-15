import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ensureDistBuild } from '../../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../../helpers/ports';

/* Editing an Angular page's colocated `export const routes = [...]` (the
 * routes the build wires into `provideRouter` itself) in `absolute dev`.
 * The edit applied, but dev printed no `routes update` line: the dev route
 * refresh only read `APP_BASE_HREF` + `provideRouter` hosts, so a colocated
 * table never had a before/after to report. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const PAGE = `import { Component } from '@angular/core';
import { RouterOutlet, type Routes } from '@angular/router';

@Component({
	selector: 'routed-a',
	standalone: true,
	template: '<p id="routed-a">ROUTED_A</p>'
})
export class RoutedAComponent {}

@Component({
	selector: 'routed-b',
	standalone: true,
	template: '<p id="routed-b">ROUTED_B</p>'
})
export class RoutedBComponent {}

@Component({
	selector: 'routed-c',
	standalone: true,
	template: '<p id="routed-c">ROUTED_C</p>'
})
export class RoutedCComponent {}

export const routes: Routes = [
	{ component: RoutedAComponent, path: 'a' },
	{ component: RoutedBComponent, path: 'b' }
];

@Component({
	imports: [RouterOutlet],
	selector: 'routed-page',
	standalone: true,
	template: '<main id="shell"><router-outlet /></main>'
})
export class RoutedPageComponent {}
`;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	angularDirectory: './angular',
	buildDirectory: './build'
});
`,
	'angular/pages/routed-page.ts': PAGE,
	'package.json': `{ "name": "angular-colocated-routes-hmr-app", "private": true, "type": "module" }
`,
	'server.ts': `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleAngularPageRequest } from '@absolutejs/absolute/angular';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/ng/*', ({ request }) =>
		handleAngularPageRequest({
			indexPath: asset(manifest, 'RoutedPageIndex'),
			pagePath: asset(manifest, 'RoutedPage'),
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

const startApp = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-ng-colocated-routes-'));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);
	const port = await getAvailablePort();
	const server = Bun.spawn(['bun', CLI_ENTRY, 'dev', 'server.ts'], {
		cwd: root,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: 'development',
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

const waitFor = async <T>(
	read: () => T | Promise<T>,
	done: (value: T) => boolean,
	timeoutMs = 60_000
) => {
	const deadline = Date.now() + timeoutMs;
	let last = await read();
	while (!done(last) && Date.now() < deadline) {
		await Bun.sleep(200);
		last = await read();
	}

	return last;
};

const fetchText = async (url: string) => (await fetch(url)).text();
const fetchStatus = async (url: string) =>
	(await fetch(url, { headers: { accept: 'text/html' } })).status;

// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

describe('dev: editing an Angular page’s colocated routes', () => {
	let app: RunningApp | undefined;
	const url = (path: string) => `${app?.baseUrl ?? ''}${path}`;
	const pagePath = () =>
		join(app?.root ?? '', 'angular/pages/routed-page.ts');
	const editPage = async (edit: (source: string) => string) => {
		const path = pagePath();
		await writeFile(path, edit(await readFile(path, 'utf-8')));
	};
	const logText = () => stripAnsi(app?.log.join('') ?? '');
	const routeLines = () =>
		logText()
			.split('\n')
			.filter((line) => line.includes('routes update'));

	beforeAll(async () => {
		await ensureDistBuild();
		app = await startApp();
	}, 600_000);

	afterAll(async () => {
		if (!app) return;
		app.server.kill();
		await app.server.exited;
		await rm(app.root, { force: true, recursive: true });
	});

	test('an added route logs `routes update +path` and renders on the server', async () => {
		expect(await fetchText(url('/ng/a'))).toContain('ROUTED_A');
		// No route matches `c` yet: the page answers 404.
		expect(await fetchStatus(url('/ng/c'))).toBe(404);
		// Let the HMR watcher settle after the first-request page build.
		await Bun.sleep(1_500);

		await editPage((source) =>
			source.replace(
				"{ component: RoutedBComponent, path: 'b' }",
				"{ component: RoutedBComponent, path: 'b' },\n\t{ component: RoutedCComponent, path: 'c' }"
			)
		);

		const lines = await waitFor(routeLines, (found) => found.length > 0);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(
			/routes update \/\S*angular\/pages\/routed-page\.ts \+c$/
		);

		// The line is published once the server bundle has the edit.
		expect(await fetchText(url('/ng/c'))).toContain('ROUTED_C');
	}, 120_000);

	test('a removed route logs `routes update -path`', async () => {
		await editPage((source) =>
			source.replace(
				"\t{ component: RoutedAComponent, path: 'a' },\n",
				''
			)
		);

		const lines = await waitFor(routeLines, (found) => found.length > 1);
		expect(lines).toHaveLength(2);
		expect(lines[1]).toMatch(
			/routes update \/\S*angular\/pages\/routed-page\.ts -a$/
		);
		expect(await fetchText(url('/ng/b'))).toContain('ROUTED_B');
		// The 404 check reads the rebuilt page's routes on each request.
		expect(await fetchStatus(url('/ng/a'))).toBe(404);
	}, 120_000);

	test('an edit that leaves the routes alone logs no routes update', async () => {
		await editPage((source) => source.replace('ROUTED_B', 'ROUTED_B2'));
		await waitFor(
			() => fetchText(url('/ng/b')),
			(html) => html.includes('ROUTED_B2')
		);
		expect(await fetchText(url('/ng/b'))).toContain('ROUTED_B2');
		expect(routeLines()).toHaveLength(2);
	}, 120_000);
});
