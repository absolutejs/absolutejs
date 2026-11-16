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

/* Form routes end to end in an app laid out like a create-absolutejs
 * scaffold (src/backend/server.ts, src/frontend/{react,html,htmx}):
 *   - a React page using `useFormAction` through the typed client
 *     (`createFormActionClient<typeof server>()`), its route reading the
 *     no-JavaScript result with the typed `getActionState`;
 *   - a static HTML page with `<form data-absolute-action>` and
 *     `enhanceForms`;
 *   - an HTMX page with `hx-post` and the route's `htmx` fragment.
 * Each is driven in a real browser with JavaScript on and off (field
 * errors with the typed values kept, success, redirect), and
 * `absolute typecheck` proves the types hold in the app, including that
 * the typed client rejects a wrong path or field. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');
const PORT = 4547;
const BASE = `http://localhost:${PORT}`;

const CONFIG_TS = `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	assetsDirectory: 'src/backend/assets',
	buildDirectory: 'build',
	htmlDirectory: 'src/frontend/html',
	htmxDirectory: 'src/frontend/htmx',
	publicDirectory: 'public',
	reactDirectory: 'src/frontend/react'
});
`;

const AUTH_TS = `import { Elysia } from 'elysia';

type User = { id: number; name: string };
const guest: User = { id: 0, name: 'Guest' };

// Stands in for an auth plugin: every request is a signed-in guest.
export const auth = new Elysia({ name: 'auth' }).derive('global', () => ({
	user: guest
}));
`;

const SERVER_TS = `import { Elysia, t } from 'elysia';
import {
	asset,
	handleHTMLPageRequest,
	handleHTMXPageRequest,
	networking,
	prepare,
	type ActionResult
} from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { actions } from '../frontend/actions';
import { Signup } from '../frontend/react/pages/Signup';
import { auth } from './auth';

const { absolutejs, manifest } = await prepare();

const escapeHtml = (value: string) =>
	value.replace(/[&<>"]/g, (char) => \`&#\${char.charCodeAt(0)};\`);

const page = (html: string) =>
	new Response(\`<!doctype html><html><body>\${html}</body></html>\`, {
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});

export const server = new Elysia()
	.use(absolutejs)
	.use(auth)
	// The return type keeps TypeScript from inferring this route from
	// \`actions\`, which is typed by this app.
	.get(
		'/',
		(): Promise<Response> =>
			handleReactPageRequest({
				Page: Signup,
				index: asset(manifest, 'SignupIndex'),
				props: {
					signupState: actions.getActionState('/actions/signup') ?? null
				}
			})
	)
	.get('/contact', () => handleHTMLPageRequest(asset(manifest, 'Contact')))
	.get('/subscribe', () =>
		handleHTMXPageRequest(asset(manifest, 'Subscribe'))
	)
	.get('/welcome', ({ query }) =>
		page(\`<h1 id="welcome">Welcome, \${escapeHtml(String(query.name ?? ''))}</h1>\`)
	)
	.get('/subscribed', () => page('<h1 id="subscribed-page">Subscribed</h1>'))
	.post(
		'/actions/signup',
		{
			form: {
				body: t.Object({
					email: t.String({ error: 'Enter a valid email', format: 'email' }),
					name: t.String({
						error: 'Name must be at least 2 characters',
						minLength: 2
					})
				}),
				redirect: (data: { name: string }) =>
					\`/welcome?name=\${encodeURIComponent(data.name)}\`
			}
		},
		({ body, fail, user }) =>
			body.name === 'taken'
				? fail({ name: 'That name is taken' })
				: { invitedBy: user.name, name: body.name }
	)
	.post(
		'/actions/contact',
		{
			form: t.Object({
				message: t.String({ error: 'Message is too short', minLength: 5 }),
				topic: t.String()
			})
		},
		({ body }) => ({ topic: body.topic })
	)
	.post(
		'/actions/subscribe',
		{
			form: {
				body: t.Object({
					email: t.String({ error: 'Enter a valid email', format: 'email' }),
					weekly: t.Boolean()
				}),
				htmx: (result: ActionResult<{ email: string }, 'email' | 'weekly'>) =>
					result.status === 'success'
						? \`<p id="subscribed">Subscribed \${escapeHtml(result.data?.email ?? '')}</p>\`
						: \`<p id="subscribe-error">\${escapeHtml(result.errors.email ?? '')}</p>\`,
				redirect: '/subscribed'
			}
		},
		({ body }) => ({ email: body.email, weekly: body.weekly })
	)
	.use(networking);

export type Server = typeof server;
`;

const ACTIONS_TS = `import { createFormActionClient } from '@absolutejs/absolute/react/hooks';
import type { Server } from '../backend/server';

// Typed by the server's routes; the import is type-only, so no server code
// reaches the browser bundle.
export const actions = createFormActionClient<Server>();
`;

/* Compiled by \`absolute typecheck\` only: each line must be an error. */
const TYPE_PROBE_TS = `import type { FormActionStateOf } from '@absolutejs/absolute';
import type { Server } from '../backend/server';
import { actions } from './actions';

export const probeUnknownPath = () =>
	// @ts-expect-error — not a route of the app
	actions.getActionState('/actions/nope');

export const probeNonFormRoute = () =>
	// @ts-expect-error — a GET page, not a form route
	actions.getActionState('/contact');

export const probeFields = (state: FormActionStateOf<Server, '/actions/signup'>) =>
	state.status === 'error'
		? // @ts-expect-error — not a field of the signup form
			state.errors.nickname
		: undefined;

export const probeData = (state: FormActionStateOf<Server, '/actions/signup'>) =>
	state.status === 'success' ? state.data?.invitedBy.toUpperCase() : undefined;
`;

const SIGNUP_TSX = `import { useEffect, useState } from 'react';
import type { ActionState } from '@absolutejs/absolute';
import { actions } from '../../actions';

type SignupProps = { signupState: ActionState | null };

export const Signup = ({ signupState }: SignupProps) => {
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => setHydrated(true), []);
	const signup = actions.useFormAction('/actions/signup', {
		initialState: signupState
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
			<p id="contact-success" data-action-success hidden>Message sent</p>
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
			<label><input name="weekly" type="checkbox" /> Weekly</label>
			<button type="submit">Subscribe</button>
		</form>
		<div id="subscribe-result"></div>
	</body>
</html>
`;

const TSCONFIG: Record<string, unknown> = {
	compilerOptions: {
		esModuleInterop: true,
		forceConsistentCasingInFileNames: true,
		incremental: true,
		jsx: 'react-jsx',
		module: 'ESNext',
		moduleResolution: 'bundler',
		noUncheckedIndexedAccess: true,
		skipLibCheck: true,
		strict: true,
		target: 'ESNext',
		tsBuildInfoFile: '.absolutejs/tsconfig.tsbuildinfo'
	},
	exclude: ['node_modules', 'build', 'dist']
};

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
	const frontend = join(projectRoot, 'src', 'frontend');
	await Promise.all(
		[
			'src/backend/assets',
			'src/frontend/react/pages',
			'src/frontend/html/pages',
			'src/frontend/html/scripts',
			'src/frontend/htmx/pages',
			'public'
		].map((dir) => mkdir(join(projectRoot, dir), { recursive: true }))
	);
	await Promise.all([
		writeFile(
			join(projectRoot, 'package.json'),
			JSON.stringify({
				name: 'form-actions-scaffold',
				private: true,
				scripts: {
					start: 'absolute start',
					typecheck: 'absolute typecheck'
				},
				type: 'module'
			})
		),
		writeFile(join(projectRoot, 'tsconfig.json'), JSON.stringify(TSCONFIG)),
		writeFile(join(projectRoot, 'absolute.config.ts'), CONFIG_TS),
		writeFile(join(projectRoot, 'src/backend/auth.ts'), AUTH_TS),
		writeFile(join(projectRoot, 'src/backend/server.ts'), SERVER_TS),
		writeFile(join(frontend, 'actions.ts'), ACTIONS_TS),
		writeFile(join(frontend, 'typeProbe.ts'), TYPE_PROBE_TS),
		writeFile(join(frontend, 'react/pages/Signup.tsx'), SIGNUP_TSX),
		writeFile(join(frontend, 'html/pages/Contact.html'), CONTACT_HTML),
		writeFile(
			join(frontend, 'html/scripts/enhance-contact.ts'),
			CONTACT_TS
		),
		writeFile(join(frontend, 'htmx/pages/Subscribe.html'), SUBSCRIBE_HTML),
		copyFile(
			join(repoRoot, 'example', 'htmx', 'htmx.2.0.11.min.js'),
			join(frontend, 'htmx', 'htmx.2.0.11.min.js')
		)
	]);
};

const runCli = async (args: string[]) => {
	const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
		cwd: root,
		env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	]);

	return { exitCode, output: `${stdout}\n${stderr}` };
};

const waitForServer = async () => {
	for (let attempt = 0; attempt < 240; attempt++) {
		const ready = await fetch(`${BASE}/subscribed`)
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

let typecheck: { exitCode: number; output: string } | undefined;

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute-form-scaffold-'));
	await linkNodeModules(root);
	await writeProject(root);
	typecheck = await runCli(['typecheck']);
	server = Bun.spawn(['bun', CLI_ENTRY, 'start'], {
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
	});
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

const withSession = async (
	javaScriptEnabled: boolean,
	run: (page: Page) => Promise<void>
) => {
	if (!browser) throw new Error('no browser');
	const context: BrowserContext = await browser.newContext({
		javaScriptEnabled
	});
	const page = await context.newPage();
	try {
		await run(page);
	} finally {
		await context.close();
	}
};

/* A value set on window survives only if the page never reloads. */
const markWindow = (page: Page) =>
	page.evaluate(() => Reflect.set(window, '__formActionMarker', 1));
const windowMarked = (page: Page) =>
	page.evaluate(() => Reflect.get(window, '__formActionMarker') === 1);

describe('form routes in a scaffolded app: types', () => {
	test('absolute typecheck passes (the probes are errors where they should be)', () => {
		expect(typecheck?.output).not.toMatch(/<error |error TS/);
		expect(typecheck?.exitCode).toBe(0);
	});
});

describe('form routes in a scaffolded app: JavaScript off', () => {
	test('React page: errors keep the typed values, success follows the redirect', () =>
		withSession(false, async (page) => {
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
			expect(page.url()).toBe(`${BASE}/welcome?name=Ada`);
			expect(await page.textContent('#welcome')).toBe('Welcome, Ada');
		}));

	test('static HTML page: the server writes errors and values into the form; success shows', () =>
		withSession(false, async (page) => {
			await page.goto(`${BASE}/contact`);
			expect(await page.textContent('#enhanced')).toBe('no');
			await page.selectOption('select[name="topic"]', 'support');
			await page.fill('textarea[name="message"]', 'hey');
			await page.click('button');
			await page.waitForSelector('#message-error:not([hidden])');
			expect(page.url()).toBe(`${BASE}/contact`);
			expect(await page.textContent('#message-error')).toBe(
				'Message is too short'
			);
			expect(await page.inputValue('textarea[name="message"]')).toBe(
				'hey'
			);
			expect(await page.inputValue('select[name="topic"]')).toBe(
				'support'
			);

			await page.fill('textarea[name="message"]', 'hello there');
			await page.click('button');
			await page.waitForSelector('#contact-success:not([hidden])');
			expect(page.url()).toBe(`${BASE}/contact`);
		}));

	test('HTMX page: the hx-post form posts, shows errors with values, then redirects', () =>
		withSession(false, async (page) => {
			await page.goto(`${BASE}/subscribe`);
			await page.fill('input[name="email"]', 'bad');
			await page.check('input[name="weekly"]');
			await page.click('button');
			await page.waitForSelector('#email-error:not([hidden])');
			expect(await page.textContent('#email-error')).toBe(
				'Enter a valid email'
			);
			expect(await page.inputValue('input[name="email"]')).toBe('bad');
			expect(await page.isChecked('input[name="weekly"]')).toBe(true);

			await page.fill('input[name="email"]', 'ada@example.com');
			await page.click('button');
			await page.waitForSelector('#subscribed-page');
			expect(page.url()).toBe(`${BASE}/subscribed`);
		}));
});

describe('form routes in a scaffolded app: JavaScript on', () => {
	test('React page: the typed useFormAction shows errors in place, then follows the redirect', () =>
		withSession(true, async (page) => {
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
			expect(await page.inputValue('input[name="name"]')).toBe('taken');
			expect(await windowMarked(page)).toBe(true);

			await page.fill('input[name="email"]', 'taken@example.com');
			await page.click('button');
			await page.waitForSelector('#name-error');
			expect(await page.textContent('#name-error')).toBe(
				'That name is taken'
			);
			expect(await windowMarked(page)).toBe(true);

			await page.fill('input[name="name"]', 'Grace');
			await page.click('button');
			await page.waitForURL(`${BASE}/welcome?name=Grace`);
			expect(await page.textContent('#welcome')).toBe('Welcome, Grace');
		}));

	test('static HTML page: enhanceForms renders errors and success in place', () =>
		withSession(true, async (page) => {
			await page.goto(`${BASE}/contact`);
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
			expect(await page.inputValue('textarea[name="message"]')).toBe(
				'hey'
			);

			await page.fill('textarea[name="message"]', 'hello there');
			await page.click('button');
			await page.waitForSelector('#contact-success:not([hidden])');
			expect(await windowMarked(page)).toBe(true);
		}));

	test('HTMX page: hx-post swaps the route fragment in', () =>
		withSession(true, async (page) => {
			await page.goto(`${BASE}/subscribe`);
			await page.waitForFunction(() => 'htmx' in window);
			await markWindow(page);
			await page.fill('input[name="email"]', 'bad');
			await page.click('button');
			await page.waitForSelector('#subscribe-error');
			expect(await page.textContent('#subscribe-error')).toBe(
				'Enter a valid email'
			);
			expect(await page.inputValue('input[name="email"]')).toBe('bad');

			await page.fill('input[name="email"]', 'ada@example.com');
			await page.click('button');
			await page.waitForSelector('#subscribed');
			expect(await page.textContent('#subscribed')).toBe(
				'Subscribed ada@example.com'
			);
			expect(await windowMarked(page)).toBe(true);
		}));
});

describe('form routes in a scaffolded app: plain HTTP', () => {
	test('a JSON client gets the data with 200 and the field errors with 422', async () => {
		const ok = await fetch(`${BASE}/actions/signup`, {
			body: JSON.stringify({ email: 'a@b.co', name: 'Ada' }),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		});
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual({ invitedBy: 'Guest', name: 'Ada' });
		const failed = await fetch(`${BASE}/actions/signup`, {
			body: JSON.stringify({ email: 'a@b.co', name: 'taken' }),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		});
		expect(failed.status).toBe(422);
		expect(await failed.json()).toEqual({
			errors: { name: 'That name is taken' },
			status: 'error'
		});
	});
});
