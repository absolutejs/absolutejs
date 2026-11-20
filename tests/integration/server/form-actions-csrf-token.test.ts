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
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { waitForText } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../helpers/ports';

/* Phase 3's exit criterion: token mode passes the matrix with
 * `Sec-Fetch-Site` stripped by a proxy.
 *
 * The default protection reads `Sec-Fetch-Site`, falls back to comparing
 * `Origin` with `Host`, and — with neither header — allows the request,
 * because that is what a `curl` or a server-to-server caller looks like.
 * Some proxies strip both. A browser behind one is then indistinguishable
 * from `curl`, and every cross-site submission is allowed. That is the
 * deployment `csrf: { token: true }` exists for, and the only honest way
 * to test it is to put something in front of the app that removes the
 * headers, rather than to construct requests by hand and assume a browser
 * would behave the same way.
 *
 * So these tests reach the app through a proxy that strips them, and drive
 * a real browser through it with JavaScript on and off. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');
const SECRET = 'f'.repeat(64);

/* What a stripping proxy removes. `sec-fetch-mode` goes too: it is part of
 * the same metadata set, and leaving it would make the simulation
 * selective in a way no real proxy is. */
const STRIPPED = ['origin', 'sec-fetch-site', 'sec-fetch-mode'];

/* Forwarding a streamed body needs `duplex: 'half'` at runtime, which the
 * DOM lib's RequestInit does not declare; spread so it is not an excess
 * property. */
type StreamInit = { duplex: 'half' };

const STREAM_INIT: StreamInit = { duplex: 'half' };

const CONFIG_TS = `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	assetsDirectory: 'src/backend/assets',
	buildDirectory: 'build',
	htmlDirectory: 'src/frontend/html',
	publicDirectory: 'public',
	reactDirectory: 'src/frontend/react'
});
`;

const SERVER_TS = `import { Elysia, t } from 'elysia';
import {
	asset,
	getActionState,
	handleHTMLPageRequest,
	networking,
	prepare
} from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { Join } from '../frontend/react/pages/Join';

const { absolutejs, manifest } = await prepare();

const page = (html: string) =>
	new Response(\`<!doctype html><html><body>\${html}</body></html>\`, {
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});

export const server = new Elysia()
	.use(absolutejs)
	.get(
		'/join',
		(): Promise<Response> =>
			handleReactPageRequest({
				Page: Join,
				index: asset(manifest, 'JoinIndex'),
				props: { joinState: getActionState('/actions/join') ?? null }
			})
	)
	.get('/subscribe', () => handleHTMLPageRequest(asset(manifest, 'Subscribe')))
	.get('/joined', () => page('<h1 id="joined">Joined</h1>'))
	// Token mode: the hidden field or the header, on top of the default
	// header check.
	.post(
		'/actions/join',
		{
			form: {
				body: t.Object({
					name: t.String({ error: 'Name is too short', minLength: 2 })
				}),
				csrf: { token: true },
				redirect: '/joined'
			}
		},
		({ body }) => ({ name: body.name })
	)
	// The same form without token mode, as the control: this is what every
	// form looked like before, and behind a stripping proxy it is what an
	// unprotected form looks like.
	.post(
		'/actions/open',
		{
			form: {
				body: t.Object({
					name: t.String({ error: 'Name is too short', minLength: 2 })
				}),
				redirect: '/joined'
			}
		},
		({ body }) => ({ name: body.name })
	)
	.use(networking);

export type Server = typeof server;
`;

const JOIN_TSX = `import type { ActionState } from '@absolutejs/absolute';
import { CsrfField } from '@absolutejs/absolute/react/components';
import { useFormAction } from '@absolutejs/absolute/react/hooks';

type JoinProps = { joinState: ActionState | null };

export const Join = ({ joinState }: JoinProps) => {
	const join = useFormAction<{ name: string }, 'name'>('/actions/join', {
		initialState: joinState
	});

	return (
		<form id="join" {...join.formProps}>
			<CsrfField />
			<input aria-label="Name" name="name" defaultValue={join.values.name} />
			<p id="name-error" data-action-error="name" hidden={!join.errors.name}>
				{join.errors.name}
			</p>
			<p id="join-status">{join.state.status}</p>
			<button type="submit">Join</button>
		</form>
	);
};
`;

/* A static HTML page cannot embed a per-visitor token: it is a file, the
 * same bytes for everyone. Its forms depend on `enhanceForms` reading the
 * cookie and sending the header, which is the reason the cookie is not
 * HttpOnly — and the reason this page needs JavaScript under token mode.
 * The tests below pin both halves of that down. */
const SUBSCRIBE_HTML = `<!doctype html>
<html>
	<head>
		<title>Subscribe</title>
		<script type="module" src="../scripts/enhance.ts"></script>
	</head>
	<body>
		<form id="subscribe" method="post" action="/actions/join" data-absolute-action>
			<input aria-label="Name" name="name" />
			<p id="subscribe-error" data-action-error="name" hidden></p>
			<p id="subscribed" data-action-success hidden>Subscribed</p>
			<button type="submit">Subscribe</button>
		</form>
		<p id="enhanced">no</p>
	</body>
</html>
`;

const ENHANCE_TS = `import { enhanceForms } from '@absolutejs/absolute/client';

enhanceForms();
const marker = document.querySelector('#enhanced');
if (marker) marker.textContent = 'yes';
`;

const TSCONFIG: Record<string, unknown> = {
	compilerOptions: {
		esModuleInterop: true,
		forceConsistentCasingInFileNames: true,
		jsx: 'react-jsx',
		module: 'ESNext',
		moduleResolution: 'bundler',
		noUncheckedIndexedAccess: true,
		skipLibCheck: true,
		strict: true,
		target: 'ESNext'
	},
	exclude: ['node_modules', 'build', 'dist']
};

let root: string | undefined;
let server: ReturnType<typeof Bun.spawn> | undefined;
let proxy: ReturnType<typeof Bun.serve> | undefined;
let browser: Browser | undefined;
let serverLog = '';
let appPort = 0;
let proxyPort = 0;

const APP = () => `http://localhost:${appPort}`;
const PROXIED = () => `http://localhost:${proxyPort}`;

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

const writeProject = async (projectRoot: string) => {
	const frontend = join(projectRoot, 'src', 'frontend');
	await Promise.all(
		[
			'src/backend/assets',
			'src/frontend/react/pages',
			'src/frontend/html/pages',
			'src/frontend/html/scripts',
			'public'
		].map((dir) => mkdir(join(projectRoot, dir), { recursive: true }))
	);
	await Promise.all([
		writeFile(
			join(projectRoot, 'package.json'),
			JSON.stringify({
				name: 'form-actions-csrf-token',
				private: true,
				scripts: { start: 'absolute start' },
				type: 'module'
			})
		),
		writeFile(join(projectRoot, 'tsconfig.json'), JSON.stringify(TSCONFIG)),
		writeFile(join(projectRoot, 'absolute.config.ts'), CONFIG_TS),
		writeFile(join(projectRoot, 'src/backend/server.ts'), SERVER_TS),
		writeFile(join(frontend, 'react/pages/Join.tsx'), JOIN_TSX),
		writeFile(join(frontend, 'html/pages/Subscribe.html'), SUBSCRIBE_HTML),
		writeFile(join(frontend, 'html/scripts/enhance.ts'), ENHANCE_TS)
	]);
};

/* The proxy. Forwards everything but the headers a stripping proxy
 * removes, and does not follow redirects, so the browser sees the app's
 * 303 and its Set-Cookie exactly as the app wrote them. */
const startProxy = () =>
	Bun.serve({
		idleTimeout: 60,
		port: proxyPort,
		fetch: async (request) => {
			const url = new URL(request.url);
			const headers = new Headers(request.headers);
			STRIPPED.forEach((name) => headers.delete(name));
			const forwarded = await fetch(
				`${APP()}${url.pathname}${url.search}`,
				{
					...STREAM_INIT,
					body: request.body,
					headers,
					method: request.method,
					redirect: 'manual'
				}
			);

			// `fetch` has already decoded the body, so forwarding the
			// encoding headers would describe bytes that are no longer
			// there and the browser would fail to parse the asset.
			const answer = new Headers(forwarded.headers);
			answer.delete('content-encoding');
			answer.delete('content-length');

			return new Response(forwarded.body, {
				headers: answer,
				status: forwarded.status
			});
		}
	});

const readChunks = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	decoder: TextDecoder
): Promise<void> => {
	const { done, value } = await reader.read();
	if (done) return undefined;
	serverLog += decoder.decode(value);

	return readChunks(reader, decoder);
};

const drain = async (stream: ReadableStream<Uint8Array> | null) => {
	if (!stream) return;
	await readChunks(stream.getReader(), new TextDecoder());
};

const waitForServer = async () => {
	for (let attempt = 0; attempt < 240; attempt++) {
		const ready = await fetch(`${APP()}/joined`)
			.then((response) => response.ok)
			.catch(() => false);
		if (ready) return;
		await Bun.sleep(250);
	}
	throw new Error(`production server did not start:\n${serverLog}`);
};

beforeAll(async () => {
	await ensureDistBuild();
	[appPort, proxyPort] = await Promise.all([
		getAvailablePort(),
		getAvailablePort()
	]);
	root = await mkdtemp(join(tmpdir(), 'absolute-csrf-token-'));
	await linkNodeModules(root);
	await writeProject(root);
	server = Bun.spawn(['bun', CLI_ENTRY, 'start'], {
		cwd: root,
		env: {
			...process.env,
			ABSOLUTE_SECRET: SECRET,
			FORCE_COLOR: '0',
			NODE_ENV: 'production',
			PORT: String(appPort),
			TELEMETRY_OFF: '1'
		},
		stderr: 'pipe',
		stdout: 'pipe'
	});
	void drain(server.stdout instanceof ReadableStream ? server.stdout : null);
	void drain(server.stderr instanceof ReadableStream ? server.stderr : null);
	await waitForServer();
	proxy = startProxy();
	browser = process.env.ABSOLUTE_TEST_BROWSER_CDP
		? await chromium.connectOverCDP(process.env.ABSOLUTE_TEST_BROWSER_CDP)
		: await chromium.launch({ args: ['--no-sandbox'], headless: true });
}, 600_000);

afterAll(async () => {
	await browser?.close().catch(() => undefined);
	proxy?.stop(true);
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

const withSession = async (
	javaScriptEnabled: boolean,
	run: (page: Page) => Promise<void>
) => {
	if (!browser) throw new Error('no browser');
	const context = await browser.newContext({ javaScriptEnabled });
	try {
		await run(await context.newPage());
	} finally {
		await context.close();
	}
};

/* The proxy strips the headers, so nothing here needs to pretend to be a
 * browser: these are the requests a cross-site page would cause, arriving
 * the way they arrive behind such a proxy. */
const postThroughProxy = (
	path: string,
	body: string,
	headers: Record<string, string> = {}
) =>
	fetch(`${PROXIED()}${path}`, {
		body,
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			...headers
		},
		method: 'POST',
		redirect: 'manual'
	});

const tokenFromPage = async () => {
	const response = await fetch(`${PROXIED()}/join`);
	const html = await response.text();
	const cookie = response.headers
		.getSetCookie()
		.find((entry) => entry.startsWith('absolute_csrf='));
	const field = /name="_csrf"[^>]*value="([^"]+)"/.exec(html)?.[1];

	return {
		cookie: cookie?.split(';')[0] ?? '',
		field: field ?? '',
		html
	};
};

describe('a page rendered behind a header-stripping proxy', () => {
	test('the proxy really does remove what the default check reads', async () => {
		// Otherwise every assertion below would be measuring the ordinary
		// same-origin path.
		const response = await fetch(`${PROXIED()}/joined`, {
			headers: {
				origin: PROXIED(),
				'sec-fetch-site': 'cross-site'
			}
		});
		expect(response.ok).toBe(true);
		const seen = await postThroughProxy('/actions/open', 'name=Ada', {
			origin: 'https://evil.test',
			'sec-fetch-site': 'cross-site'
		});
		// A cross-site post the app cannot see as cross-site: accepted.
		// This is the gap token mode closes, and it is why the stripped
		// header matters at all.
		expect(seen.status).toBe(303);
	});

	test('a server-rendered form carries a token, and the cookie that matches it', async () => {
		const { cookie, field } = await tokenFromPage();
		expect(cookie).toStartWith('absolute_csrf=');
		expect(field).not.toBe('');
		expect(cookie.slice('absolute_csrf='.length)).toBe(field);
	});

	test('a submission with the field and its cookie is accepted', async () => {
		const { cookie, field } = await tokenFromPage();
		const response = await postThroughProxy(
			'/actions/join',
			`name=Ada&_csrf=${encodeURIComponent(field)}`,
			{ cookie }
		);
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/joined');
	});

	test('a submission with the header and its cookie is accepted', async () => {
		const { cookie, field } = await tokenFromPage();
		const response = await postThroughProxy('/actions/join', 'name=Ada', {
			cookie,
			'x-absolute-csrf': field
		});
		expect(response.status).toBe(303);
	});

	test('a cross-site submission with no token is refused', async () => {
		// The same request the control route accepted above.
		const response = await postThroughProxy('/actions/join', 'name=Ada', {
			origin: 'https://evil.test',
			'sec-fetch-site': 'cross-site'
		});
		expect(response.status).toBe(403);
	});

	test("another visitor's token does not work with this visitor's cookie", async () => {
		const mine = await tokenFromPage();
		const theirs = await tokenFromPage();
		const response = await postThroughProxy(
			'/actions/join',
			`name=Ada&_csrf=${encodeURIComponent(theirs.field)}`,
			{ cookie: mine.cookie }
		);
		expect(response.status).toBe(403);
	});
});

describe('a real browser behind the proxy', () => {
	test('a framework page submits without JavaScript', async () => {
		await withSession(false, async (page) => {
			await page.goto(`${PROXIED()}/join`);
			// The field is in the server-rendered markup, which is what
			// makes this work with no JavaScript at all.
			expect(
				await page.locator('#join input[name="_csrf"]').count()
			).toBe(1);
			await page.fill('input[name="name"]', 'Ada');
			await Promise.all([
				page.waitForURL(`${PROXIED()}/joined`),
				page.click('button[type="submit"]')
			]);
			expect(await page.locator('#joined').textContent()).toBe('Joined');
		});
	}, 120_000);

	test('a framework page shows field errors without JavaScript', async () => {
		await withSession(false, async (page) => {
			await page.goto(`${PROXIED()}/join`);
			await page.fill('input[name="name"]', 'A');
			await Promise.all([
				page.waitForURL(`${PROXIED()}/join`),
				page.click('button[type="submit"]')
			]);
			// A rejected token would have answered 403 instead of
			// re-rendering the form with its error.
			expect(
				await waitForText(
					page,
					'#name-error',
					(text) => text.trim() !== ''
				)
			).toBe('Name is too short');
		});
	}, 120_000);

	test('a static HTML page submits with JavaScript, through the header', async () => {
		await withSession(true, async (page) => {
			await page.goto(`${PROXIED()}/subscribe`);
			await waitForText(page, '#enhanced', (text) => text === 'yes');
			// No `_csrf` field to send: the page is one file for every
			// visitor. The token comes from the cookie the page itself was
			// served with, in a header.
			expect(
				await page.locator('#subscribe input[name="_csrf"]').count()
			).toBe(0);
			await page.fill('input[name="name"]', 'Ada');
			const [response] = await Promise.all([
				page.waitForResponse((answer) =>
					answer.url().endsWith('/actions/join')
				),
				page.click('button[type="submit"]')
			]);
			// 200 with a JSON result, not the 303 a plain form POST gets:
			// this went through fetch.
			expect(response.status()).toBe(200);
			// The action declares a redirect, so the helper follows it.
			await page.waitForURL(`${PROXIED()}/joined`);
			expect(await page.locator('#joined').textContent()).toBe('Joined');
		});
	}, 120_000);

	test('a static HTML page cannot submit without JavaScript under token mode', async () => {
		// Not a defect to fix here but a limitation to know: a static page
		// is one file for every visitor, so it has no per-visitor token to
		// embed, and behind a stripping proxy there is nothing else left to
		// identify the submission. Such a page needs either JavaScript, or
		// a framework page, or token mode off.
		await withSession(false, async (page) => {
			await page.goto(`${PROXIED()}/subscribe`);
			expect(
				await page.locator('#subscribe input[name="_csrf"]').count()
			).toBe(0);
			await page.fill('input[name="name"]', 'Ada');
			const [response] = await Promise.all([
				page.waitForResponse((answer) =>
					answer.url().endsWith('/actions/join')
				),
				page.click('button[type="submit"]')
			]);
			expect(response.status()).toBe(403);
		});
	}, 120_000);
});
