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
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../helpers/ports';

/* docs/SECURITY_HEADERS.md, as written, under secureHeaders().
 *
 * The doc imported `getCspNonce` from '@absolutejs/absolute' into a React
 * page. That entry is server code, so the React client build failed
 * ("Browser build cannot import Node.js builtin"). `getCspNonce` now comes
 * from '@absolutejs/absolute/react', which is browser-safe and gives the
 * same value on both sides: the request's nonce during SSR, the page's
 * nonce (read back from its own scripts) while hydrating.
 *
 * This project is the doc's server and page samples verbatim. In dev and in
 * production the client build succeeds, the page's inline script carries
 * the response's nonce and runs, and the page hydrates with no CSP
 * violation and no hydration warning. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: 'build',
	reactDirectory: 'src/frontend/react'
});
`,
	'package.json': `{ "name": "csp-nonce-page-script", "private": true, "type": "module" }
`,
	// docs/SECURITY_HEADERS.md: "Register it before absolutejs".
	'src/backend/server.ts': `import { Elysia } from 'elysia';
import {
	asset,
	networking,
	prepare,
	secureHeaders
} from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { Home } from '../frontend/react/pages/Home';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(secureHeaders())
	.use(absolutejs)
	.get('/', () =>
		handleReactPageRequest({
			index: asset(manifest, 'HomeIndex'),
			Page: Home,
			props: {}
		})
	)
	.use(networking);
`,
	// docs/SECURITY_HEADERS.md: "For your own inline scripts on those
	// pages, use the nonce yourself".
	'src/frontend/react/pages/Home.tsx': `import { getCspNonce } from '@absolutejs/absolute/react';
import { useState } from 'react';

const analytics = 'window.analyticsLoaded = true;';

export const Home = () => {
	const [count, setCount] = useState(0);

	return (
		<html>
			<head>
				<meta charSet="utf-8" />
				<title>Home</title>
			</head>
			<body>
				<button onClick={() => setCount(count + 1)} type="button">
					count {count}
				</button>
				<script
					nonce={getCspNonce()}
					dangerouslySetInnerHTML={{ __html: analytics }}
					suppressHydrationWarning
				/>
			</body>
		</html>
	);
};
`,
	'tsconfig.json': `{
	"compilerOptions": {
		"jsx": "react-jsx",
		"module": "esnext",
		"moduleResolution": "bundler",
		"skipLibCheck": true,
		"strict": true,
		"target": "esnext"
	}
}
`
};

/* Every package from the repo's node_modules, except @absolutejs/absolute,
 * which points at this checkout. */
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
	output: () => string;
	root: string;
	server: ReturnType<typeof Bun.spawn>;
};

const startApp = async (prefix: string, args: string[], nodeEnv: string) => {
	const root = await mkdtemp(join(tmpdir(), prefix));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);
	const port = await getAvailablePort();
	const baseUrl = `http://localhost:${port}`;
	const server = Bun.spawn(['bun', CLI_ENTRY, ...args], {
		cwd: root,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: nodeEnv,
			PORT: String(port),
			TELEMETRY_OFF: '1'
		},
		stderr: 'pipe',
		stdout: 'pipe'
	});
	let output = '';
	const collect = async (stream: ReadableStream<Uint8Array>) => {
		const decoder = new TextDecoder();
		for await (const chunk of stream) output += decoder.decode(chunk);
	};
	void collect(server.stdout);
	void collect(server.stderr);
	const app: RunningApp = { baseUrl, root, server, output: () => output };
	for (let attempt = 0; attempt < 480; attempt++) {
		if (server.exitCode !== null)
			throw new Error(
				`absolute ${args[0]} exited with ${server.exitCode}:\n${output}`
			);
		try {
			const response = await fetch(`${baseUrl}/`);
			if (response.ok) return app;
		} catch {
			// not listening yet
		}
		await Bun.sleep(250);
	}
	throw new Error(`absolute ${args[0]} did not start:\n${output}`);
};

const stopApp = async (app: RunningApp | undefined) => {
	if (!app) return;
	app.server.kill();
	await app.server.exited;
	await rm(app.root, { force: true, recursive: true });
};

const isCspMessage = (message: string) =>
	/Content Security Policy|violates the following/i.test(message);

const isHydrationMessage = (message: string) =>
	/hydrat|mismatch|did not match|Minified React error #(418|419|423|425)/i.test(
		message
	);

const expectDocumentedPattern = async (app: RunningApp) => {
	const { baseUrl } = app;
	expect(app.output()).not.toMatch(/Browser build cannot import/);

	// SSR: the page's own inline script carries the response's nonce.
	const response = await fetch(`${baseUrl}/`);
	const policy = response.headers.get('content-security-policy') ?? '';
	const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
	expect(nonce).toBeTruthy();
	const html = await response.text();
	const inline = Array.from(
		html.matchAll(/<script\b[^>]*>([^<]*)<\/script>/g)
	).find(([, body]) => body?.includes('analyticsLoaded'));
	expect(inline?.[0]).toContain(`nonce="${nonce}"`);

	// The client bundle built and loads.
	const indexSrc = Array.from(
		html.matchAll(/<script\b[^>]*\bsrc="([^"]*)"/g),
		([, src]) => src ?? ''
	).find((src) => /indexes\/Home\b/.test(src));
	expect(indexSrc).toBeTruthy();
	const bundle = await fetch(new URL(indexSrc ?? '', baseUrl));
	expect(bundle.status).toBe(200);

	const messages: string[] = [];
	const session = await openPage(`${baseUrl}/`, {
		consoleLog: (message) => messages.push(message)
	});
	const { page } = session;
	page.on('pageerror', (error) => messages.push(error.message));
	try {
		// Load it again with the listener in place, for this response's nonce.
		const navigation = await page.goto(`${baseUrl}/`, {
			waitUntil: 'load'
		});
		const pageNonce = /'nonce-([^']+)'/.exec(
			(await navigation?.allHeaders())?.['content-security-policy'] ?? ''
		)?.[1];
		expect(pageNonce).toBeTruthy();
		// The browser ran the script: the nonce matched the policy.
		expect(
			await page.evaluate(() => Reflect.get(window, 'analyticsLoaded'))
		).toBe(true);
		// Hydrated: the button responds.
		await page.waitForFunction(
			() => {
				const button = document.querySelector('button');
				button?.click();

				return /count [1-9]/.test(button?.textContent ?? '');
			},
			undefined,
			{ polling: 250, timeout: 30_000 }
		);
		// What getCspNonce() reads in the browser is this page's nonce.
		expect(
			await page.evaluate(
				() =>
					document.querySelector<HTMLScriptElement>('script[nonce]')
						?.nonce
			)
		).toBe(pageNonce);
		await Bun.sleep(500);
		expect(messages.filter(isCspMessage)).toEqual([]);
		expect(messages.filter(isHydrationMessage)).toEqual([]);
	} finally {
		await session.close();
	}
};

describe('documented CSP nonce pattern in production', () => {
	let app: RunningApp | undefined;

	beforeAll(async () => {
		await ensureDistBuild();
		app = await startApp(
			'absolute-csp-doc-prod-',
			['start', 'src/backend/server.ts', '--outdir', 'start-build'],
			'production'
		);
	}, 600_000);

	afterAll(() => stopApp(app));

	test('a React page using getCspNonce() builds, runs its inline script and hydrates', async () => {
		if (!app) throw new Error('app did not start');
		await expectDocumentedPattern(app);
	}, 120_000);
});

describe('documented CSP nonce pattern in dev', () => {
	let app: RunningApp | undefined;

	beforeAll(async () => {
		await ensureDistBuild();
		app = await startApp('absolute-csp-doc-dev-', ['dev'], 'development');
	}, 600_000);

	afterAll(() => stopApp(app));

	test('a React page using getCspNonce() builds, runs its inline script and hydrates', async () => {
		if (!app) throw new Error('app did not start');
		await expectDocumentedPattern(app);
	}, 120_000);
});
