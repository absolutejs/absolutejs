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
import type { Page } from 'playwright';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* `invalidate()` on an Angular page, which depends on how the page reads
 * its data.
 *
 * Two pages, the same in everything a visitor sees. One reads its data
 * with `usePageData()`, a signal; the other with `usePageContext()`,
 * copying the list into a field as it is constructed — the usual way.
 *
 * The first can be given new data in place. The second cannot: nothing
 * can change a field that holds a copy, and updating the rest of the
 * page around it would show two answers at once. So it must be
 * refreshed whole, exactly as before, and what is asserted for it is
 * that it IS reloaded — a page left half-updated would be the worse
 * failure.
 *
 * A project of its own under `absolute start`, because the pages must
 * import the two accessors from the package: they call `inject()`,
 * which only works against the copy of `@angular/core` the page was
 * compiled against, and that is the package's. The CLI, the page
 * handler and `invalidate` are this checkout's sources; the two
 * accessors come from the built package. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const fromSource = (path: string) =>
	resolve(repoRoot, 'src', path).replace(/\\/g, '/');
const PORT = 4622;

const CONFIG = `import { defineConfig } from '${fromSource('index.ts')}';

export default defineConfig({
	angularDirectory: './angular',
	buildDirectory: './build'
});
`;

const SERVER_TS = `import { Elysia } from 'elysia';
import { asset, networking, prepare } from '${fromSource('index.ts')}';
import { handleAngularPageRequest } from '${fromSource('angular/server.ts')}';

const { absolutejs, manifest } = await prepare();

const items: string[] = ['item 1'];

const page = (name: string, request: Request) =>
	handleAngularPageRequest({
		headTag: '<head><title>Angular items</title></head>',
		indexPath: asset(manifest, \`\${name}Index\`),
		pagePath: asset(manifest, name),
		request,
		requestContext: { items: [...items] }
	});

export const server = new Elysia()
	.use(absolutejs)
	.get('/signal', ({ request }) => page('SignalItems', request))
	.get('/plain', ({ request }) => page('PlainItems', request))
	.get('/ready', () => 'ready')
	.post('/api/add', () => {
		items.push(\`item \${items.length + 1}\`);

		return { count: items.length };
	})
	.post('/api/reset', () => {
		items.splice(0, items.length, 'item 1');

		return { count: items.length };
	})
	.use(networking);
`;

const TEMPLATE = `
		<main id="page">
			<input id="note" type="text" />
			<button id="add" type="button" (click)="add()">add</button>
			<button id="clicks" type="button" (click)="clicks.set(clicks() + 1)">{{ clicks() }}</button>
			<p id="total">{{ total() }}</p>
			<ul id="items">
				@for (item of items(); track item) {
					<li>{{ item }}</li>
				}
			</ul>
		</main>
	`;

const SHARED_BODY = `
	clicks = signal(0);

	constructor() {
		// The page is also rendered on the server, where there is no window.
		if (typeof window === 'undefined') return;
		Reflect.set(window, '__mounts', Number(Reflect.get(window, '__mounts') ?? 0) + 1);
		Reflect.set(window, '__pageHydrated', true);
	}

	async add() {
		await fetch('/api/add', { method: 'POST' });
		// \`invalidate\` is handed to the page by the test (see
		// \`giveInvalidate\`), from this checkout's sources.
		const invalidate = Reflect.get(window, '__absoluteInvalidate');
		Reflect.set(window, '__outcome', await invalidate());
	}
`;

/* Reads its data as a signal: the list and the count derived from it
 * follow a refresh. */
const SIGNAL_PAGE = `import { Component, computed, signal } from '@angular/core';
import { usePageData } from '@absolutejs/absolute/angular';

type Data = { items: string[] };

@Component({
	selector: 'signal-items',
	standalone: true,
	template: \`${TEMPLATE}\`
})
export class SignalItems {
	private data = usePageData<Data>();
	items = computed(() => this.data().items);
	total = computed(() => this.items().length);
${SHARED_BODY}
}
`;

/* Copies its data into a field as it is constructed — the usual way,
 * and one nothing can update afterwards. */
const PLAIN_PAGE = `import { Component, computed, signal } from '@angular/core';
import { usePageContext } from '@absolutejs/absolute/angular';

type Data = { items: string[] };

@Component({
	selector: 'plain-items',
	standalone: true,
	template: \`${TEMPLATE}\`
})
export class PlainItems {
	private copied = usePageContext<Data>().items;
	items = signal(this.copied);
	total = computed(() => this.items().length);
${SHARED_BODY}
}
`;

let root = '';
let server: ReturnType<typeof Bun.spawn> | undefined;
let invalidateBundle = '';

/* The page cannot import \`invalidate\` from this checkout: an Angular
 * page is compiled with its project as the root, and a source path
 * outside it is refused. Importing it from the package would test
 * whatever was built into \`dist/\` last. So the current source is
 * bundled here and put on the page, which calls it through a global. */
const bundleInvalidate = async () => {
	const entry = join(root, 'invalidate-entry.ts');
	await writeFile(
		entry,
		`import { invalidate } from '${fromSource('client/invalidate')}';\nReflect.set(window, '__absoluteInvalidate', invalidate);\n`
	);
	const built = await Bun.build({
		entrypoints: [entry],
		format: 'esm',
		target: 'browser'
	});
	const [output] = built.outputs;
	if (!built.success || !output)
		throw new Error('could not bundle invalidate for the page');

	return output.text();
};

const linkNodeModules = async (projectRoot: string) => {
	const source = join(repoRoot, 'node_modules');
	const target = join(projectRoot, 'node_modules');
	await mkdir(target, { recursive: true });
	const entries = await readdir(source);
	await Promise.all(
		entries
			.filter((name) => name !== '.bin')
			.map((name) => symlink(join(source, name), join(target, name)))
	);
};

const url = (path: string) => `http://localhost:${PORT}${path}`;

const waitForServer = async (attempt = 0): Promise<void> => {
	if (attempt >= 480) throw new Error('production server did not start');
	const up = await fetch(url('/ready'))
		.then(async (response) => {
			await response.body?.cancel();

			return response.ok;
		})
		.catch(() => false);
	if (up) return;
	await Bun.sleep(250);
	await waitForServer(attempt + 1);
};

beforeAll(async () => {
	await ensureDistBuild();
	root = await mkdtemp(join(tmpdir(), 'absolute-angular-refresh-'));
	await mkdir(join(root, 'angular', 'pages'), { recursive: true });
	await writeFile(
		join(root, 'angular', 'pages', 'signal-items.ts'),
		SIGNAL_PAGE
	);
	await writeFile(
		join(root, 'angular', 'pages', 'plain-items.ts'),
		PLAIN_PAGE
	);
	await writeFile(join(root, 'absolute.config.ts'), CONFIG);
	await writeFile(join(root, 'server.ts'), SERVER_TS);
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: 'angular-refresh-fixture', type: 'module' })
	);
	await writeFile(
		join(root, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				experimentalDecorators: true,
				module: 'ESNext',
				moduleResolution: 'bundler',
				strict: true,
				target: 'ES2022'
			}
		})
	);
	await linkNodeModules(root);
	invalidateBundle = await bundleInvalidate();

	server = Bun.spawn(['bun', CLI_ENTRY, 'start', 'server.ts'], {
		cwd: root,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: 'production',
			PORT: String(PORT),
			TELEMETRY_OFF: '1'
		},
		stderr: 'inherit',
		stdout: 'inherit'
	});
	await waitForServer();
}, 600_000);

afterAll(async () => {
	server?.kill();
	await server?.exited;
	if (root) await rm(root, { force: true, recursive: true });
});

type PageLog = { entries: string[] };

const openItems = async (path: string, log: PageLog) => {
	await fetch(url('/api/reset'), { method: 'POST' });
	const record = (page: Page) => {
		page.on('pageerror', (error) => {
			log.entries.push(`pageerror: ${error.message}`);
		});
		page.on('console', (message) => {
			if (message.type() === 'error')
				log.entries.push(`console.error: ${message.text()}`);
		});
	};
	const session: BrowserSession = await openPage(url(path), {
		onPage: record,
		waitUntil: 'load'
	});
	// With what the page logged, so a page that never started says why.
	await session.page
		.waitForFunction(
			() => Reflect.get(window, '__pageHydrated') === true,
			undefined,
			{ timeout: 30_000 }
		)
		.catch((error: unknown) => {
			throw new Error(
				`${path} did not start: ${String(error)}\n${log.entries.join('\n')}`
			);
		});
	await session.page.addScriptTag({
		content: invalidateBundle,
		type: 'module'
	});
	await session.page.waitForFunction(
		() => typeof Reflect.get(window, '__absoluteInvalidate') === 'function'
	);
	await session.page.evaluate(() => {
		Reflect.set(window, '__sameDocument', true);
	});

	return session;
};

const itemTexts = (page: Page) => page.locator('#items li').allTextContents();

const waitForItems = (page: Page, count: number) =>
	page.waitForFunction(
		(expected) =>
			document.querySelectorAll('#items li').length === expected,
		count,
		{ timeout: 30_000 }
	);

const read = (page: Page, name: string) =>
	page.evaluate((key) => Reflect.get(window, key), name);

describe('invalidate() on an Angular page that reads its data as a signal', () => {
	test('gives the page the new data without unmounting it', async () => {
		const log: PageLog = { entries: [] };
		const session = await openItems('/signal', log);
		try {
			const { page } = session;
			expect(await itemTexts(page)).toEqual(['item 1']);
			await page.click('#clicks');
			await page.click('#clicks');
			await page.fill('#note', 'half-typed');

			await page.click('#add');
			await waitForItems(page, 2);

			expect(await itemTexts(page)).toEqual(['item 1', 'item 2']);
			await page.waitForFunction(
				() => Reflect.get(window, '__outcome') !== undefined
			);
			// In place, and provably so: a page that quietly reloaded
			// would have the new list too, and none of the rest.
			expect(await read(page, '__outcome')).toBe('updated');
			expect(await read(page, '__sameDocument')).toBe(true);
			expect(await read(page, '__mounts')).toBe(1);
			expect(await page.locator('#clicks').textContent()).toBe('2');
			expect(await page.inputValue('#note')).toBe('half-typed');
			expect(log.entries).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);

	test('what the page derives from its data follows it', async () => {
		const log: PageLog = { entries: [] };
		const session = await openItems('/signal', log);
		try {
			const { page } = session;

			await page.click('#add');
			await waitForItems(page, 2);
			await page.click('#add');
			await waitForItems(page, 3);

			expect(await page.locator('#total').textContent()).toBe('3');
			expect(await read(page, '__sameDocument')).toBe(true);
			expect(await read(page, '__mounts')).toBe(1);
			expect(log.entries).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);
});

describe('invalidate() on an Angular page that copies its data', () => {
	/* The page holds a copy nothing can update. It is refreshed whole —
	 * here, with no navigation layer, by reloading — and the list is
	 * right because the page was made again from the new data. */
	test('is refreshed whole, never half-updated', async () => {
		const log: PageLog = { entries: [] };
		const session = await openItems('/plain', log);
		try {
			const { page } = session;
			await page.click('#clicks');

			await Promise.all([
				page.waitForEvent('load', { timeout: 30_000 }),
				page.click('#add')
			]);
			await waitForItems(page, 2);

			expect(await itemTexts(page)).toEqual(['item 1', 'item 2']);
			// The count beside the list agrees with it: one answer.
			expect(await page.locator('#total').textContent()).toBe('2');
			// A new document: the mark set on the old one is gone.
			expect(await read(page, '__sameDocument')).toBeUndefined();
			expect(log.entries).toEqual([]);
		} finally {
			await session.close();
		}
	}, 120_000);
});
