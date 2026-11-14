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
import type { Page } from 'playwright';
import { openPage, type BrowserSession } from '../../../helpers/browser';
import { ensureDistBuild } from '../../../helpers/ensureDistBuild';
import { getAvailablePort } from '../../../helpers/ports';

/* Repeated edits to the host of a React page that renders an <Island>.
 *
 * Saving the page (or a component it imports) often never reached the
 * screen: the dependency graph listed the backend route file that imports
 * the page as a dependent of the edit, no fast path claimed it, so the same
 * save ran the React fast path AND a full build and sent two
 * `react-update`s (plus `module-update` and `framework-update`). The
 * client applied both at once, racing each other.
 *
 * Every save must reach the screen as exactly one React update, without a
 * reload, keeping both the island's state and the host page's own state. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');
const EDIT_COUNT = 20;

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: 'build',
	islands: { registry: 'src/islands/registry.ts' },
	reactDirectory: 'src/frontend/react'
});
`,
	'package.json': `{ "name": "island-host-hmr-app", "private": true, "type": "module" }
`,
	'src/backend/server.ts': `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { IslandsPage } from '../frontend/react/pages/IslandsPage';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/islands', () =>
		handleReactPageRequest({
			index: asset(manifest, 'IslandsPageIndex'),
			Page: IslandsPage,
			props: {}
		})
	)
	.use(networking);
`,
	'src/frontend/react/components/Label.tsx': `export const Label = () => <p className="label">LABEL_0</p>;
`,
	'src/frontend/react/pages/IslandsPage.tsx': `import { useState } from 'react';
import { Island } from '@absolutejs/absolute/react';
import { Label } from '../components/Label';

export const IslandsPage = () => {
	const [hostCount, setHostCount] = useState(0);

	return (
		<html>
			<head>
				<meta charSet="utf-8" />
				<title>Islands</title>
			</head>
			<body>
				<h1 className="heading">HOST_0</h1>
				<Label />
				<button className="host-counter" onClick={() => setHostCount(hostCount + 1)} type="button">
					HOST_COUNT {hostCount}
				</button>
				<Island component="ReactCounter" framework="react" props={{ start: 3 }} />
			</body>
		</html>
	);
};
`,
	'src/islands/ReactCounter.tsx': `import { useState } from 'react';

export const ReactCounter = ({ start }: { start: number }) => {
	const [count, setCount] = useState(start);

	return (
		<button className="react-island" onClick={() => setCount(count + 1)} type="button">
			REACT_ISLAND {count}
		</button>
	);
};
`,
	'src/islands/registry.ts': `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import { ReactCounter } from './ReactCounter';

export const islandRegistry = defineIslandRegistry({
	react: { ReactCounter }
});
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

let root = '';
let baseUrl = '';
let server: ReturnType<typeof Bun.spawn> | undefined;
const serverLog: string[] = [];

const collectOutput = async (stream: ReadableStream<Uint8Array>) => {
	const decoder = new TextDecoder();
	for await (const chunk of stream) serverLog.push(decoder.decode(chunk));
};

const waitForServer = async () => {
	for (let attempt = 0; attempt < 480; attempt++) {
		if (server?.exitCode !== null && server?.exitCode !== undefined)
			throw new Error(`absolute dev exited with ${server.exitCode}`);
		try {
			const response = await fetch(`${baseUrl}/islands`);
			if (response.ok) return;
		} catch {
			// not listening yet
		}
		await Bun.sleep(250);
	}
	throw new Error('dev server did not start');
};

const editFile = async (path: string, from: string, to: string) => {
	const filePath = join(root, path);
	const source = await readFile(filePath, 'utf-8');
	if (!source.includes(from)) throw new Error(`${from} not in ${path}`);
	await writeFile(filePath, source.replace(from, to));
};

const textOf = (page: Page, selector: string) =>
	page.evaluate(
		(target) => document.querySelector(target)?.textContent ?? null,
		selector
	);

const waitForText = (
	page: Page,
	selector: string,
	text: string,
	timeout = 30_000
) =>
	page.waitForFunction(
		([target, expected]) =>
			document.querySelector(target ?? '')?.textContent === expected,
		[selector, text],
		{ timeout }
	);

type Watched = {
	hmrMessages: string[];
	messages: string[];
	session: BrowserSession;
};

const openWatched = async (path: string): Promise<Watched> => {
	const messages: string[] = [];
	const hmrMessages: string[] = [];
	const session = await openPage(`${baseUrl}${path}`, {
		consoleLog: (message) => messages.push(message)
	});
	session.page.on('pageerror', (error) => messages.push(error.message));
	session.page.on('websocket', (socket) => {
		socket.on('framereceived', ({ payload }) => {
			try {
				const { type } = JSON.parse(String(payload));
				if (typeof type === 'string' && type !== 'pong')
					hmrMessages.push(type);
			} catch {
				// not JSON
			}
		});
	});
	// The socket opened during navigation, before the listener above:
	// reload once so it is observed from its first frame.
	await session.page.reload({ waitUntil: 'load' });

	return { hmrMessages, messages, session };
};

const prepareHost = async (page: Page) => {
	await page.waitForSelector(
		'[data-island="true"][data-component="ReactCounter"][data-hydrated="true"]',
		{ timeout: 30_000 }
	);
	// Give the host and the island state their server render does not hold.
	await page.click('.react-island');
	await waitForText(page, '.react-island', 'REACT_ISLAND 4');
	await page.click('.host-counter');
	await waitForText(page, '.host-counter', 'HOST_COUNT 1');
	await page.evaluate(() => Reflect.set(window, '__noReload', true));
};

const expectStateKept = async (page: Page) => {
	expect(await page.evaluate(() => Reflect.get(window, '__noReload'))).toBe(
		true
	);
	expect(await textOf(page, '.react-island')).toBe('REACT_ISLAND 4');
	expect(await textOf(page, '.host-counter')).toBe('HOST_COUNT 1');
};

/* Edit `file` EDIT_COUNT times, each save replacing `<prefix>_<n>` with
 * `<prefix>_<n + 1>`, and require every save to reach `selector` as one
 * React update. */
const runEdits = async (
	watched: Watched,
	file: string,
	prefix: string,
	selector: string
) => {
	const { hmrMessages, session } = watched;
	const { page } = session;
	for (let edit = 0; edit < EDIT_COUNT; edit++) {
		hmrMessages.length = 0;
		const logStart = serverLog.length;
		await editFile(file, `${prefix}_${edit}`, `${prefix}_${edit + 1}`);
		try {
			await waitForText(page, selector, `${prefix}_${edit + 1}`, 10_000);
		} catch {
			throw new Error(
				`edit ${edit + 1} of ${file} never reached the page; ` +
					`socket: ${hmrMessages.join(', ')}; ` +
					`server: ${serverLog.slice(logStart).join('')}`
			);
		}
		// Let any second update for the same save arrive before counting.
		await Bun.sleep(400);
		expect({
			edit: edit + 1,
			reactUpdates: hmrMessages.filter((type) => type === 'react-update')
				.length
		}).toEqual({ edit: edit + 1, reactUpdates: 1 });
		expect(await textOf(page, selector)).toBe(`${prefix}_${edit + 1}`);
		await expectStateKept(page);
	}
};

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute island host hmr '));
	await Promise.all(
		Object.entries(FILES).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);
	await linkNodeModules(root);
	const port = await getAvailablePort();
	baseUrl = `http://localhost:${port}`;
	server = Bun.spawn(['bun', CLI_ENTRY, 'dev'], {
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
	void collectOutput(server.stdout as ReadableStream<Uint8Array>);
	void collectOutput(server.stderr as ReadableStream<Uint8Array>);
	await waitForServer();
}, 600_000);

afterAll(async () => {
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

describe('dev: repeated host edits on a page with an island', () => {
	test(`${EDIT_COUNT} host page edits each apply once and keep state`, async () => {
		const watched = await openWatched('/islands');
		try {
			await prepareHost(watched.session.page);
			await runEdits(
				watched,
				'src/frontend/react/pages/IslandsPage.tsx',
				'HOST',
				'.heading'
			);
			expect(
				watched.messages.filter((message) => /hydrat/i.test(message))
			).toEqual([]);
		} finally {
			await watched.session.close();
		}
	}, 300_000);

	test(`${EDIT_COUNT} imported component edits each apply once and keep state`, async () => {
		const watched = await openWatched('/islands');
		try {
			await prepareHost(watched.session.page);
			await runEdits(
				watched,
				'src/frontend/react/components/Label.tsx',
				'LABEL',
				'.label'
			);
			expect(
				watched.messages.filter((message) => /hydrat/i.test(message))
			).toEqual([]);
		} finally {
			await watched.session.close();
		}
	}, 300_000);
});
