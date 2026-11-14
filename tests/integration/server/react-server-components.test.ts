import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import {
	cp,
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
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* Phase 1 of React Server Components (docs/REACT_SERVER_COMPONENTS_PLAN.md):
 * an async server-component page with a "use client" counter, served from
 * an ordinary Elysia route, server-rendered and hydrated under both
 * `absolute start` (production) and `absolute dev`.
 *
 * react-server-dom-webpack is a peer the application installs. When the
 * repo's node_modules has no copy, point ABSOLUTE_TEST_REACT_SERVER_DOM at an
 * unpacked react-server-dom-webpack package matching react's minor. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');
const FIXTURE = join(repoRoot, 'tests', 'fixtures', 'react-server-components');
const PROD_PORT = 4510;
const DEV_PORT = 4511;

const resolveFlightPackage = () => {
	const configured = process.env.ABSOLUTE_TEST_REACT_SERVER_DOM;
	if (configured) return existsSync(configured) ? configured : undefined;
	try {
		return dirname(
			Bun.resolveSync('react-server-dom-webpack/package.json', repoRoot)
		);
	} catch {
		return undefined;
	}
};
const flightPackage = resolveFlightPackage();

const CONFIG_TS = `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: './build',
	reactServerComponentsDirectory: './rsc'
});
`;

const SERVER_TS = `import { Elysia } from 'elysia';
import { asset, networking, prepare, secureHeaders } from '@absolutejs/absolute';
import { handleReactServerPageRequest } from '@absolutejs/absolute/react';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(secureHeaders())
	.use(absolutejs)
	.get('/', () =>
		handleReactServerPageRequest({
			page: asset(manifest, 'HomeRSC'),
			props: { greeting: 'Hello from a server component' }
		})
	)
	.get('/about', () =>
		handleReactServerPageRequest({ page: asset(manifest, 'AboutRSC') })
	)
	.get('/manifest', () => manifest)
	.use(networking);
`;

/* Link every package from the repo's node_modules except
 * @absolutejs/absolute (this checkout) and react-server-dom-webpack, which
 * is copied: Bun resolves a symlinked package from its real path, where
 * react-dom would not be found. */
const prepareProject = async (projectRoot: string, flightDir: string) => {
	await cp(FIXTURE, projectRoot, {
		recursive: true,
		filter: (source) => !/[\\/](?:node_modules|build)([\\/]|$)/.test(source)
	});
	const source = join(repoRoot, 'node_modules');
	const target = join(projectRoot, 'node_modules');
	await mkdir(join(target, '@absolutejs'), { recursive: true });
	const [entries, scoped] = await Promise.all([
		readdir(source),
		readdir(join(source, '@absolutejs'))
	]);
	await Promise.all([
		...entries
			.filter(
				(name) =>
					name !== '@absolutejs' &&
					name !== '.bin' &&
					name !== 'react-server-dom-webpack'
			)
			.map((name) => symlink(join(source, name), join(target, name))),
		...scoped
			.filter((name) => name !== 'absolute' && !name.startsWith('.'))
			.map((name) =>
				symlink(
					join(source, '@absolutejs', name),
					join(target, '@absolutejs', name)
				)
			),
		symlink(repoRoot, join(target, '@absolutejs', 'absolute')),
		cp(flightDir, join(target, 'react-server-dom-webpack'), {
			recursive: true
		})
	]);
	await writeFile(join(projectRoot, 'absolute.config.ts'), CONFIG_TS);
	await writeFile(join(projectRoot, 'server.ts'), SERVER_TS);
};

const waitForServer = async (port: number) => {
	for (let attempt = 0; attempt < 240; attempt++) {
		try {
			const response = await fetch(`http://localhost:${port}/manifest`);
			if (response.ok) return;
		} catch {
			// not listening yet
		}
		await Bun.sleep(250);
	}
	throw new Error(`server on ${port} did not start`);
};

type RunningServer = { log: () => Promise<string>; stop: () => Promise<void> };

const startServer = (
	projectRoot: string,
	command: 'dev' | 'start',
	port: number
) => {
	const proc = Bun.spawn(['bun', CLI_ENTRY, command, 'server.ts'], {
		cwd: projectRoot,
		env: {
			...process.env,
			ABSOLUTE_PORT: String(port),
			FORCE_COLOR: '0',
			NODE_ENV: command === 'start' ? 'production' : 'development',
			PORT: String(port),
			TELEMETRY_OFF: '1'
		},
		stderr: 'pipe',
		// `absolute dev` reads keyboard shortcuts; keep its stdin open.
		stdin: 'pipe',
		stdout: 'pipe'
	});
	// Drained from the start so a chatty server never blocks on a full pipe.
	const output = Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);
	const running: RunningServer = {
		log: async () => Bun.stripANSI((await output).join('\n')),
		stop: async () => {
			proc.kill();
			await proc.exited;
		}
	};

	return running;
};

type PageCheck = {
	afterClicks: string | null;
	beforeClicks: string | null;
	errors: string[];
	slowNote: string | null;
};

const checkInBrowser = async (port: number) => {
	const errors: string[] = [];
	const session = await openPage(`http://localhost:${port}/`, {
		consoleLog: (message) => {
			if (/error|refused|violat/i.test(message)) errors.push(message);
		}
	});
	try {
		session.page.on('pageerror', (error) => errors.push(error.message));
		const counter = session.page.getByTestId('counter');
		const beforeClicks = await counter.textContent();
		// Hydration is done when a click updates the client component.
		await counter.click();
		await session.page.waitForFunction(
			() =>
				document.querySelector('[data-testid="counter"]')
					?.textContent === 'Count: 6',
			undefined,
			{ timeout: 10_000 }
		);
		await counter.click();
		const result: PageCheck = {
			afterClicks: await counter.textContent(),
			beforeClicks,
			errors,
			slowNote: await session.page.getByTestId('slow-note').textContent()
		};

		return result;
	} finally {
		await session.close();
	}
};

type AboutCheck = {
	errors: string[];
	linkHref: string | null;
	streamSlot: string | null;
	suspenseSlot: string | null;
};

/* The page that imports react/components from a server component: the
 * slots stream in and Link (a client reference) hydrates without errors. */
const checkAboutInBrowser = async (port: number) => {
	const errors: string[] = [];
	const session = await openPage(`http://localhost:${port}/about`, {
		consoleLog: (message) => {
			if (/error|refused|violat/i.test(message)) errors.push(message);
		}
	});
	try {
		session.page.on('pageerror', (error) => errors.push(error.message));
		await session.page.waitForSelector('[data-testid="suspense-slot"]', {
			timeout: 10_000
		});
		const result: AboutCheck = {
			errors,
			linkHref: await session.page
				.getByTestId('home-link')
				.getAttribute('href'),
			streamSlot: await session.page
				.getByTestId('stream-slot')
				.textContent(),
			suspenseSlot: await session.page
				.getByTestId('suspense-slot')
				.textContent()
		};

		return result;
	} finally {
		await session.close();
	}
};

let root = '';
let prodAboutCheck: AboutCheck | undefined;
let prodHtml = '';
let prodAboutHtml = '';
let prodAboutStatus = 0;
let prodManifest: Record<string, string> = {};
let prodHeaders = new Headers();
let prodClientJs = '';
let prodServerBundleStatus = 0;
let prodCheck: PageCheck | undefined;
let prodLog = '';
let devHtml = '';
let devCheck: PageCheck | undefined;
let devLog = '';
let devEditedHtml = '';

/* Edit a server component under `absolute dev` and fetch until the page
 * renders the edit (the RSC pass rebuilds; a reload picks it up). */
const editAndRefetch = async (projectRoot: string, port: number) => {
	const pagePath = join(projectRoot, 'rsc', 'pages', 'Home.tsx');
	const source = await readFile(pagePath, 'utf8');
	await writeFile(
		pagePath,
		source.replace('rendered by Bun', 'rendered after an edit by Bun')
	);
	for (let attempt = 0; attempt < 60; attempt++) {
		const html = await (await fetch(`http://localhost:${port}/`)).text();
		if (html.includes('rendered after an edit')) return html;
		await Bun.sleep(250);
	}

	return '';
};

describe.skipIf(!flightPackage)('React Server Components (phase 1)', () => {
	beforeAll(async () => {
		if (!flightPackage) return;
		await ensureDistBuild();
		root = await mkdtemp(join(tmpdir(), 'absolute-rsc-'));
		await prepareProject(root, flightPackage);

		const prod = startServer(root, 'start', PROD_PORT);
		try {
			await waitForServer(PROD_PORT);
			const response = await fetch(`http://localhost:${PROD_PORT}/`);
			prodHeaders = response.headers;
			prodHtml = await response.text();
			const manifest: Record<string, string> = await (
				await fetch(`http://localhost:${PROD_PORT}/manifest`)
			).json();
			prodManifest = manifest;
			const about = await fetch(`http://localhost:${PROD_PORT}/about`);
			prodAboutStatus = about.status;
			prodAboutHtml = await about.text();
			const clientUrl = manifest.ReactServerClient ?? '';
			const clientDir = join(root, 'dist', dirname(clientUrl));
			const clientFiles = (await readdir(clientDir)).filter((name) =>
				name.endsWith('.js')
			);
			prodClientJs = (
				await Promise.all(
					clientFiles.map((name) =>
						readFile(join(clientDir, name), 'utf8')
					)
				)
			).join('\n');
			const serverBundle = manifest.HomeRSC ?? '';
			const relativeBundle = serverBundle.slice(
				serverBundle.indexOf('/react/server/')
			);
			prodServerBundleStatus = (
				await fetch(`http://localhost:${PROD_PORT}${relativeBundle}`)
			).status;
			prodCheck = await checkInBrowser(PROD_PORT);
			prodAboutCheck = await checkAboutInBrowser(PROD_PORT);
		} finally {
			await prod.stop();
			prodLog = await prod.log();
		}

		const dev = startServer(root, 'dev', DEV_PORT);
		try {
			await waitForServer(DEV_PORT);
			devHtml = await (
				await fetch(`http://localhost:${DEV_PORT}/`)
			).text();
			devCheck = await checkInBrowser(DEV_PORT);
			devEditedHtml = await editAndRefetch(root, DEV_PORT);
		} finally {
			await dev.stop();
			devLog = await dev.log();
		}
	}, 600_000);

	afterAll(async () => {
		if (root) await rm(root, { force: true, recursive: true });
	});

	test('production: async server components render into the streamed HTML', () => {
		expect(prodHtml).toContain('Hello from a server component');
		expect(prodHtml).toContain('<li>alpha</li><li>beta</li><li>gamma</li>');
		expect(prodHtml).toContain('rendered by Bun');
		expect(prodHtml).toContain('Count<!-- -->: <!-- -->5');
		// The Suspense boundary streams in after the shell.
		expect(prodHtml).toContain('streamed after the shell');
		expect(prodHeaders.get('content-type')).toContain('text/html');
	});

	test('production: the Flight payload is inlined with the CSP nonce', () => {
		const nonce = /script-src[^;]*'nonce-([^']+)'/.exec(
			prodHeaders.get('content-security-policy') ?? ''
		)?.[1];
		expect(nonce).toBeTruthy();
		expect(prodHtml).toContain(
			`<script nonce="${nonce}">(self.__absoluteReactServerPayload??=[]).push(`
		);
		const inlineScripts =
			prodHtml.match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? [];
		for (const tag of inlineScripts)
			expect(tag).toContain(`nonce="${nonce}"`);
	});

	test('production: server component code stays on the server', () => {
		expect(prodClientJs.length).toBeGreaterThan(0);
		expect(prodClientJs).not.toContain('Bun.sleep');
		expect(prodClientJs).not.toContain('streamed after the shell');
		expect(prodServerBundleStatus).toBe(404);
	});

	test('production: the page hydrates and the client counter works', () => {
		expect(prodCheck?.beforeClicks).toBe('Count: 5');
		expect(prodCheck?.afterClicks).toBe('Count: 7');
		expect(prodCheck?.slowNote).toBe('streamed after the shell');
		expect(prodCheck?.errors).toEqual([]);
		expect(prodLog).not.toContain('React Server Components error');
	});

	test('production: a page file ending in RSC gets one RSC suffix, the doubled key stays as an alias', () => {
		expect(prodManifest.AboutRSC).toBeTruthy();
		expect(prodManifest.AboutRSCRSC).toBe(prodManifest.AboutRSC);
		expect(prodManifest.HomeRSC).toBeTruthy();
		expect(prodManifest.HomeRSCRSC).toBeUndefined();
	});

	test('production: a server component imports react/components directly', () => {
		expect(prodAboutStatus).toBe(200);
		expect(prodAboutHtml).toContain('data-testid="about"');
		expect(prodAboutHtml).toContain('href="/"');
		expect(prodAboutHtml).toContain('stream slot ready');
		expect(prodAboutHtml).toContain('suspense slot ready');
		expect(prodLog).not.toContain('createContext is not a function');
		expect(prodAboutCheck?.linkHref).toBe('/');
		expect(prodAboutCheck?.streamSlot).toBe('stream slot ready');
		expect(prodAboutCheck?.suspenseSlot).toBe('suspense slot ready');
		expect(prodAboutCheck?.errors).toEqual([]);
	});

	test('dev: the page renders and hydrates under absolute dev', () => {
		expect(devHtml).toContain('Hello from a server component');
		expect(devHtml).toContain('<li>alpha</li><li>beta</li><li>gamma</li>');
		expect(devCheck?.beforeClicks).toBe('Count: 5');
		expect(devCheck?.afterClicks).toBe('Count: 7');
		expect(devCheck?.slowNote).toBe('streamed after the shell');
		expect(devCheck?.errors).toEqual([]);
		expect(devLog).not.toContain('React Server Components error');
		expect(devLog).not.toContain('Could not decode sourcemap');
	});

	test('dev: an edited server component renders on the next request', () => {
		expect(devEditedHtml).toContain('rendered after an edit by Bun');
		expect(devEditedHtml).toContain('Count<!-- -->: <!-- -->5');
	});
});
