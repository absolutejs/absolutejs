import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openPage } from '../../helpers/browser';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* Opt-in web vitals in production: a page reports LCP, CLS and TTFB (and
 * the others it has) to the built-in endpoint with its route; with vitals
 * off nothing is injected; with sampleRate 0 nothing is sent. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'dist', 'cli', 'index.js');
const roots: string[] = [];

type Report = { name: string; route: string; value: number };
type Variant = {
	html: string;
	reports: Report[];
	reporterStatus: number;
};

const SERVER_TS = `import { Elysia } from 'elysia';
import {
	asset,
	handleHTMLPageRequest,
	networking,
	onVital,
	prepare
} from '@absolutejs/absolute';
import { handleSveltePageRequest } from '@absolutejs/absolute/svelte/server';

const { absolutejs, manifest } = await prepare();
const reports: unknown[] = [];
onVital((report) => {
	reports.push(report);
});

export const server = new Elysia()
	.use(absolutejs)
	.get('/', () =>
		handleSveltePageRequest({
			indexPath: asset(manifest, 'HomeIndex'),
			pagePath: asset(manifest, 'Home')
		})
	)
	.get('/plain', () => handleHTMLPageRequest(asset(manifest, 'Plain')))
	.get('/__test/vitals', () => reports)
	.use(networking);
`;

/* The repo's node_modules may hold an older published
 * @absolutejs/absolute; link everything else, and that one to this
 * checkout. */
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

const createProject = async (vitals: string) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-vitals-'));
	roots.push(root);
	await cp(join(repoRoot, 'tests', 'fixtures', 'compile-svelte'), root, {
		recursive: true,
		filter: (source) => !/[\\/]node_modules([\\/]|$)/.test(source)
	});
	await linkNodeModules(root);
	await mkdir(join(root, 'html', 'pages'), { recursive: true });
	await writeFile(
		join(root, 'html', 'pages', 'Plain.html'),
		'<!doctype html><html><head><title>plain</title></head><body><h1>Plain page</h1></body></html>\n'
	);
	await writeFile(join(root, 'server.ts'), SERVER_TS);
	await writeFile(
		join(root, 'absolute.config.ts'),
		`import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: './build',
	htmlDirectory: './html',
	publicDirectory: './public',
	svelteDirectory: './svelte'${vitals ? `,\n\tvitals: ${vitals}` : ''}
});
`
	);

	return root;
};

const waitForServer = async (port: number) => {
	for (let attempt = 0; attempt < 240; attempt++) {
		try {
			await fetch(`http://localhost:${port}/`);

			return;
		} catch {
			await Bun.sleep(250);
		}
	}
	throw new Error('production server did not start');
};

/** Builds and starts the project, visits `/` and `/plain`, then leaves each
 *  page so the reporter flushes, and returns what the server received. */
const runVariant = async (vitals: string, port: number) => {
	const root = await createProject(vitals);
	const proc = Bun.spawn(
		['bun', CLI_ENTRY, 'start', 'server.ts', '--outdir', 'start-build'],
		{
			cwd: root,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NODE_ENV: 'production',
				PORT: String(port),
				TELEMETRY_OFF: '1'
			},
			stderr: 'pipe',
			stdout: 'pipe'
		}
	);
	try {
		await waitForServer(port);
		const base = `http://localhost:${port}`;
		const session = await openPage(`${base}/`);
		await session.page.waitForTimeout(1_500);
		await session.page.goto(`${base}/plain`, { waitUntil: 'load' });
		await session.page.waitForTimeout(1_500);
		await session.page.goto('about:blank');
		await Bun.sleep(1_000);
		await session.close();
		const reports: Report[] = await (
			await fetch(`${base}/__test/vitals`)
		).json();
		const html = await (await fetch(`${base}/plain`)).text();
		const reporter = await fetch(`${base}/__absolute/vitals/reporter.js`);
		const variant: Variant = {
			html,
			reporterStatus: reporter.status,
			reports
		};

		return variant;
	} finally {
		proc.kill();
		await proc.exited;
	}
};

const results: Partial<Record<'disabled' | 'enabled' | 'unsampled', Variant>> =
	{};
const variant = (name: keyof typeof results) => {
	const value = results[name];
	if (!value) throw new Error(`no ${name} result`);

	return value;
};

beforeAll(async () => {
	await ensureDistBuild();
	results.enabled = await runVariant('{ sampleRate: 1 }', 4481);
	results.disabled = await runVariant('', 4482);
	results.unsampled = await runVariant('{ sampleRate: 0 }', 4483);
}, 600_000);

afterAll(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('web vitals in production', () => {
	test('pages report LCP, CLS and TTFB with their route', () => {
		const { reports } = variant('enabled');
		const namesFor = (route: string) =>
			new Set(
				reports
					.filter((report) => report.route === route)
					.map((report) => report.name)
			);

		for (const route of ['/', '/plain']) {
			const names = namesFor(route);
			expect(names.has('LCP')).toBe(true);
			expect(names.has('CLS')).toBe(true);
			expect(names.has('TTFB')).toBe(true);
		}
		expect(reports.every((report) => Number.isFinite(report.value))).toBe(
			true
		);
		expect(variant('enabled').html).toContain(
			'/__absolute/vitals/reporter.js'
		);
	});

	test('with vitals off, no reporter is injected or built', () => {
		const { html, reporterStatus, reports } = variant('disabled');

		expect(html).not.toContain('vitals');
		expect(reporterStatus).toBe(404);
		expect(reports).toEqual([]);
	});

	test('with sampleRate 0, nothing is sent', () => {
		const { html, reports } = variant('unsampled');

		expect(html).toContain('/__absolute/vitals/reporter.js');
		expect(reports).toEqual([]);
	});
});
