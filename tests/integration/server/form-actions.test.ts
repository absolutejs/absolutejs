import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	copyFile,
	mkdir,
	mkdtemp,
	readdir,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
	chromium,
	type Browser,
	type BrowserContext,
	type Page
} from 'playwright';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* Form actions in a production build, in a real browser, with JavaScript
 * on and off: a React page (useFormAction), a static HTML page
 * (<form data-absolute-action> + enhanceForms) and an HTMX page (hx-post +
 * the action's htmx fragment). Without JavaScript every form posts,
 * redirects back and shows its result; with JavaScript nothing reloads. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');
const PORT = 4541;
const BASE = `http://localhost:${PORT}`;

const ACTIONS_TS = `import { t } from 'elysia';
import { defineAction } from '@absolutejs/absolute';

const escapeHtml = (value: string) =>
	value.replace(/[&<>"]/g, (char) => \`&#\${char.charCodeAt(0)};\`);

export const createUser = defineAction('/actions/signup', {
	body: t.Object({
		email: t.String({ error: 'Enter a valid email', format: 'email' }),
		name: t.String({ error: 'Name must be at least 2 characters', minLength: 2 })
	}),
	handler: ({ body, fail }) =>
		body.name === 'taken'
			? fail({ name: 'That name is taken' })
			: { greeting: \`Welcome, \${body.name}\` }
});

export const contact = defineAction('/actions/contact', {
	body: t.Object({
		message: t.String({ error: 'Message is too short', minLength: 5 }),
		topic: t.String()
	}),
	handler: () => ({ sent: true }),
	redirect: '/thanks'
});

export const subscribe = defineAction('/actions/subscribe', {
	body: t.Object({
		email: t.String({ error: 'Enter a valid email', format: 'email' })
	}),
	handler: ({ body }) => ({ email: body.email }),
	htmx: (result) =>
		result.status === 'success'
			? \`<p id="subscribed">Subscribed \${escapeHtml(result.data?.email ?? '')}</p>\`
			: \`<p id="subscribe-error">\${escapeHtml(result.errors.email ?? '')}</p>\`
});
`;

const SERVER_TS = `import { Elysia } from 'elysia';
import {
	asset,
	getActionState,
	handleHTMLPageRequest,
	handleHTMXPageRequest,
	networking,
	prepare,
	secureHeaders
} from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { contact, createUser, subscribe } from './actions';
import { Signup } from './react/pages/Signup';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(secureHeaders())
	.use(absolutejs)
	.get('/', () =>
		handleReactPageRequest({
			Page: Signup,
			index: asset(manifest, 'SignupIndex'),
			props: { signupState: getActionState(createUser) ?? null }
		})
	)
	.get('/html', () => handleHTMLPageRequest(asset(manifest, 'Contact')))
	.get('/htmx', () => handleHTMXPageRequest(asset(manifest, 'Subscribe')))
	.get(
		'/thanks',
		() =>
			new Response('<!doctype html><h1 id="thanks">Thanks</h1>', {
				headers: { 'content-type': 'text/html; charset=utf-8' }
			})
	)
	.use(createUser)
	.use(contact)
	.use(subscribe)
	.use(networking);
`;

const SIGNUP_TSX = `import { useEffect, useState } from 'react';
import type { ActionStateOf } from '@absolutejs/absolute';
import { useFormAction } from '@absolutejs/absolute/react/hooks';
import type { createUser } from '../../actions';

type SignupProps = { signupState: ActionStateOf<typeof createUser> | null };

export const Signup = ({ signupState }: SignupProps) => {
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => setHydrated(true), []);
	const signup = useFormAction<typeof createUser>('/actions/signup', {
		initialState: signupState ?? undefined
	});

	return (
		<html>
			<head>
				<title>Signup</title>
			</head>
			<body>
				<p id="hydrated">{hydrated ? 'yes' : 'no'}</p>
				<form id="signup" {...signup.formProps}>
					<input aria-label="Name" name="name" defaultValue={signup.values.name} />
					{signup.errors.name && <p id="name-error">{signup.errors.name}</p>}
					<input aria-label="Email" name="email" defaultValue={signup.values.email} />
					{signup.errors.email && <p id="email-error">{signup.errors.email}</p>}
					<button type="submit" disabled={signup.pending}>Sign up</button>
				</form>
				{signup.state.status === 'success' && (
					<p id="welcome">{signup.data?.greeting}</p>
				)}
			</body>
		</html>
	);
};
`;

const CONTACT_HTML = `<!doctype html>
<html>
	<head>
		<title>Contact</title>
		<script type="module" src="../scripts/enhance-contact.ts"></script>
	</head>
	<body>
		<form id="contact" method="post" action="/actions/contact" data-absolute-action>
			<select aria-label="Topic" name="topic">
				<option value="sales">Sales</option>
				<option value="support">Support</option>
			</select>
			<textarea aria-label="Message" name="message"></textarea>
			<p id="message-error" data-action-error="message" hidden></p>
			<button type="submit">Send</button>
		</form>
		<p id="enhanced">no</p>
	</body>
</html>
`;

const CONTACT_TS = `import { enhanceForms } from '@absolutejs/absolute/client';

enhanceForms();
const marker = document.querySelector('#enhanced');
if (marker) marker.textContent = 'yes';
`;

const SUBSCRIBE_HTML = `<!doctype html>
<html>
	<head>
		<title>Subscribe</title>
		<script src="/htmx/htmx.min.js"></script>
	</head>
	<body>
		<form
			id="subscribe"
			method="post"
			action="/actions/subscribe"
			data-absolute-action
			hx-post="/actions/subscribe"
			hx-target="#subscribe-result"
		>
			<input aria-label="Email" name="email" />
			<p id="email-error" data-action-error="email" hidden></p>
			<p id="subscribe-success" data-action-success hidden>Subscribed</p>
			<button type="submit">Subscribe</button>
		</form>
		<div id="subscribe-result"></div>
	</body>
</html>
`;

let root = '';
let server: ReturnType<typeof Bun.spawn> | undefined;
let browser: Browser | undefined;
let serverLog = '';

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
	await Promise.all(
		[
			'react/pages',
			'html/pages',
			'html/scripts',
			'htmx/pages',
			'public'
		].map((dir) => mkdir(join(projectRoot, dir), { recursive: true }))
	);
	await Promise.all([
		writeFile(
			join(projectRoot, 'package.json'),
			JSON.stringify({
				name: 'form-actions-fixture',
				private: true,
				type: 'module'
			})
		),
		writeFile(
			join(projectRoot, 'tsconfig.json'),
			JSON.stringify({
				compilerOptions: {
					jsx: 'react-jsx',
					module: 'ESNext',
					moduleResolution: 'bundler',
					strict: true,
					target: 'ESNext'
				}
			})
		),
		writeFile(
			join(projectRoot, 'absolute.config.ts'),
			`import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: './build',
	htmlDirectory: './html',
	htmxDirectory: './htmx',
	publicDirectory: './public',
	reactDirectory: './react'
});
`
		),
		writeFile(join(projectRoot, 'actions.ts'), ACTIONS_TS),
		writeFile(join(projectRoot, 'server.ts'), SERVER_TS),
		writeFile(join(projectRoot, 'react/pages/Signup.tsx'), SIGNUP_TSX),
		writeFile(join(projectRoot, 'html/pages/Contact.html'), CONTACT_HTML),
		writeFile(
			join(projectRoot, 'html/scripts/enhance-contact.ts'),
			CONTACT_TS
		),
		writeFile(
			join(projectRoot, 'htmx/pages/Subscribe.html'),
			SUBSCRIBE_HTML
		),
		copyFile(
			join(repoRoot, 'example', 'htmx', 'htmx.2.0.6.min.js'),
			join(projectRoot, 'htmx', 'htmx.2.0.6.min.js')
		)
	]);
};

const waitForServer = async () => {
	for (let attempt = 0; attempt < 240; attempt++) {
		const ready = await fetch(`${BASE}/thanks`)
			.then((response) => response.ok)
			.catch(() => false);
		if (ready) return;
		await Bun.sleep(250);
	}
	throw new Error(`production server did not start:\n${serverLog}`);
};

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

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute-form-actions-'));
	await linkNodeModules(root);
	await writeProject(root);
	server = Bun.spawn(
		['bun', CLI_ENTRY, 'start', 'server.ts', '--outdir', 'start-build'],
		{
			cwd: root,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NODE_ENV: 'production',
				PORT: String(PORT),
				TELEMETRY_OFF: '1'
			},
			stderr: 'pipe',
			stdout: 'pipe'
		}
	);
	void drain(server.stdout instanceof ReadableStream ? server.stdout : null);
	void drain(server.stderr instanceof ReadableStream ? server.stderr : null);
	await waitForServer();
	browser = process.env.ABSOLUTE_TEST_BROWSER_CDP
		? await chromium.connectOverCDP(process.env.ABSOLUTE_TEST_BROWSER_CDP)
		: await chromium.launch({ args: ['--no-sandbox'], headless: true });
}, 600_000);

afterAll(async () => {
	await browser?.close().catch(() => undefined);
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

type Session = {
	context: BrowserContext;
	cspErrors: string[];
	page: Page;
};

const openSession = async (javaScriptEnabled: boolean) => {
	if (!browser) throw new Error('no browser');
	const context = await browser.newContext({ javaScriptEnabled });
	const page = await context.newPage();
	const cspErrors: string[] = [];
	page.on('console', (message) => {
		if (/Content Security Policy/i.test(message.text()))
			cspErrors.push(message.text());
	});
	const session: Session = { context, cspErrors, page };

	return session;
};

const withSession = async (
	javaScriptEnabled: boolean,
	run: (session: Session) => Promise<void>
) => {
	const session = await openSession(javaScriptEnabled);
	try {
		await run(session);
	} finally {
		await session.context.close();
	}
};

/* A value set on window survives only if the page never reloads. */
const markWindow = (page: Page) =>
	page.evaluate(() => Reflect.set(window, '__formActionMarker', 1));
const windowMarked = (page: Page) =>
	page.evaluate(() => Reflect.get(window, '__formActionMarker') === 1);

describe('form actions without JavaScript', () => {
	test('React page: errors and typed values come back after the redirect, success shows the data', () =>
		withSession(false, async ({ page }) => {
			await page.goto(`${BASE}/`);
			expect(await page.textContent('#hydrated')).toBe('no');
			await page.fill('input[name="name"]', 'A');
			await page.fill('input[name="email"]', 'nope');
			await Promise.all([
				page.waitForURL(`${BASE}/`),
				page.click('button')
			]);
			await page.waitForSelector('#name-error');
			expect(await page.textContent('#name-error')).toBe(
				'Name must be at least 2 characters'
			);
			expect(await page.textContent('#email-error')).toBe(
				'Enter a valid email'
			);
			expect(await page.inputValue('input[name="name"]')).toBe('A');
			expect(await page.inputValue('input[name="email"]')).toBe('nope');

			await page.fill('input[name="name"]', 'Ada');
			await page.fill('input[name="email"]', 'ada@example.com');
			await page.click('button');
			await page.waitForSelector('#welcome');
			expect(await page.textContent('#welcome')).toBe('Welcome, Ada');

			// The result is shown once: a reload is a fresh page.
			await page.reload();
			expect(await page.locator('#welcome').count()).toBe(0);
		}));

	test('static HTML page: the server writes the errors and values into the form; success redirects', () =>
		withSession(false, async ({ page }) => {
			await page.goto(`${BASE}/html`);
			expect(await page.textContent('#enhanced')).toBe('no');
			await page.selectOption('select[name="topic"]', 'support');
			await page.fill('textarea[name="message"]', 'hey');
			await page.click('button');
			await page.waitForSelector('#message-error:not([hidden])');
			expect(page.url()).toBe(`${BASE}/html`);
			expect(await page.textContent('#message-error')).toBe(
				'Message is too short'
			);
			expect(await page.inputValue('textarea[name="message"]')).toBe(
				'hey'
			);
			expect(await page.inputValue('select[name="topic"]')).toBe(
				'support'
			);
			expect(
				await page.getAttribute(
					'textarea[name="message"]',
					'aria-invalid'
				)
			).toBe('true');

			await page.fill('textarea[name="message"]', 'hello there');
			await page.click('button');
			await page.waitForSelector('#thanks');
			expect(page.url()).toBe(`${BASE}/thanks`);
		}));

	test('HTMX page: the hx-post form still posts and shows its result', () =>
		withSession(false, async ({ page }) => {
			await page.goto(`${BASE}/htmx`);
			await page.fill('input[name="email"]', 'bad');
			await page.click('button');
			await page.waitForSelector('#email-error:not([hidden])');
			expect(await page.textContent('#email-error')).toBe(
				'Enter a valid email'
			);
			expect(await page.inputValue('input[name="email"]')).toBe('bad');

			await page.fill('input[name="email"]', 'ada@example.com');
			await page.click('button');
			await page.waitForSelector('#subscribe-success:not([hidden])');
		}));
});

describe('form actions with JavaScript', () => {
	test('React page: useFormAction submits without a reload', () =>
		withSession(true, async ({ cspErrors, page }) => {
			await page.goto(`${BASE}/`);
			await page.waitForFunction(
				() => document.querySelector('#hydrated')?.textContent === 'yes'
			);
			await markWindow(page);
			await page.fill('input[name="name"]', 'taken');
			await page.fill('input[name="email"]', 'nope');
			await page.click('button');
			await page.waitForSelector('#email-error');
			expect(await page.textContent('#email-error')).toBe(
				'Enter a valid email'
			);
			// Validation stops before the handler, so only the email failed.
			expect(await page.locator('#name-error').count()).toBe(0);
			// Field values survive an error (the form is not reset).
			expect(await page.inputValue('input[name="name"]')).toBe('taken');

			await page.fill('input[name="email"]', 'taken@example.com');
			await page.click('button');
			await page.waitForSelector('#name-error');
			expect(await page.textContent('#name-error')).toBe(
				'That name is taken'
			);

			await page.fill('input[name="name"]', 'Grace');
			await page.click('button');
			await page.waitForSelector('#welcome');
			expect(await page.textContent('#welcome')).toBe('Welcome, Grace');
			expect(await page.inputValue('input[name="name"]')).toBe('');
			expect(await windowMarked(page)).toBe(true);
			expect(cspErrors).toEqual([]);
		}));

	test('static HTML page: enhanceForms renders errors in place and follows the redirect', () =>
		withSession(true, async ({ cspErrors, page }) => {
			await page.goto(`${BASE}/html`);
			await page.waitForFunction(
				() => document.querySelector('#enhanced')?.textContent === 'yes'
			);
			await markWindow(page);
			await page.fill('textarea[name="message"]', 'hey');
			await page.click('button');
			await page.waitForSelector('#message-error:not([hidden])');
			expect(await page.textContent('#message-error')).toBe(
				'Message is too short'
			);
			expect(
				await page.getAttribute('#contact', 'data-action-status')
			).toBe('error');
			expect(await windowMarked(page)).toBe(true);

			await page.fill('textarea[name="message"]', 'hello there');
			await page.click('button');
			await page.waitForURL(`${BASE}/thanks`);
			expect(cspErrors).toEqual([]);
		}));

	test('HTMX page: hx-post swaps the action fragment in', () =>
		withSession(true, async ({ cspErrors, page }) => {
			await page.goto(`${BASE}/htmx`);
			await page.waitForFunction(() => 'htmx' in window);
			await markWindow(page);
			await page.fill('input[name="email"]', 'bad');
			await page.click('button');
			await page.waitForSelector('#subscribe-error');
			expect(await page.textContent('#subscribe-error')).toBe(
				'Enter a valid email'
			);
			await page.fill('input[name="email"]', 'ada@example.com');
			await page.click('button');
			await page.waitForSelector('#subscribed');
			expect(await page.textContent('#subscribed')).toBe(
				'Subscribed ada@example.com'
			);
			expect(await windowMarked(page)).toBe(true);
			expect(cspErrors).toEqual([]);
		}));
});

describe('form actions over plain HTTP', () => {
	test('a cross-site post is refused', async () => {
		const response = await fetch(`${BASE}/actions/signup`, {
			body: new URLSearchParams({ email: 'a@b.co', name: 'Ada' }),
			headers: {
				origin: 'https://evil.example',
				'sec-fetch-site': 'cross-site'
			},
			method: 'POST',
			redirect: 'manual'
		});
		expect(response.status).toBe(403);
	});

	test('a JSON client (Eden, fetch) gets JSON', async () => {
		const response = await fetch(`${BASE}/actions/signup`, {
			body: JSON.stringify({ email: 'a@b.co', name: 'Ada' }),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		});
		expect(await response.json()).toEqual({
			data: { greeting: 'Welcome, Ada' },
			status: 'success'
		});
	});
});
