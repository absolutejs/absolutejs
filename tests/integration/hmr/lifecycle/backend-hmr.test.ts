import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { createFile, mutateFile, restoreAllFiles } from '../../../helpers/file';

/* Backend HMR (docs/BACKEND_HMR.md): editing server code updates the running
 * server in place. One dev server serves every step; each step edits a file
 * and asserts what changed, how fast, and that nothing else re-ran. */

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const BACKEND = resolve(PROJECT_ROOT, 'example/backend');
const SERVER = resolve(PROJECT_ROOT, 'example/server.ts');
const file = (name: string) => resolve(BACKEND, name);
const UPDATE_DEADLINE_MS = 5_000;
const POLL_MS = 25;
const TICK_MS = 20;
const SLOW_TICK_MS = 100;
const SAMPLE_MS = 600;

let server: DevServer;

const get = async (path: string) =>
	(await fetch(`${server.baseUrl}/hmr-backend/${path}`)).text();

/** Poll until `path` answers `expected`; returns how long that took. */
const waitFor = async (path: string, expected: string) => {
	const startedAt = performance.now();
	const deadline = Date.now() + UPDATE_DEADLINE_MS;
	let last = '';
	while (Date.now() < deadline) {
		last = await get(path);
		if (last === expected) return performance.now() - startedAt;
		await Bun.sleep(POLL_MS);
	}
	throw new Error(
		`${path} never answered ${expected} (last: ${last})\n${server.outputLines.slice(-30).join('\n')}`
	);
};

const restarted = () =>
	server.outputLines.some(
		(line) => line.includes('[abs:restart]') || line.includes('restarting')
	);

const updateLines = () =>
	server.outputLines.filter((line) => line.includes('[hmr] server:'));

const ticksOver = async (ms: number) => {
	const start = Number(await get('ticks'));
	await Bun.sleep(ms);

	return Number(await get('ticks')) - start;
};

beforeAll(async () => {
	createFile(
		file('stores.ts'),
		'export const stores = { boots: 0, cleanups: 0, setups: 0, ticks: 0 };\n'
	);
	createFile(
		file('greeting.ts'),
		"export const greeting = () => 'GREETING_ONE';\n"
	);
	createFile(
		file('state.ts'),
		[
			'let hits = 0;',
			'export const hit = () => {',
			'\thits += 1;',
			'',
			'\treturn hits;',
			'};',
			"export const label = () => 'STATE_ONE';",
			''
		].join('\n')
	);
	createFile(
		file('ticker.ts'),
		[
			"import { stores } from './stores';",
			'',
			'setInterval(() => {',
			'\tstores.ticks += 1;',
			`}, ${TICK_MS});`,
			''
		].join('\n')
	);
	createFile(
		file('plugin.ts'),
		[
			"import { Elysia } from 'elysia';",
			"import { greeting } from './greeting';",
			"import { hit, label } from './state';",
			"import { stores } from './stores';",
			"import './ticker';",
			'',
			'export const backendRoutes = () =>',
			'\tnew Elysia()',
			'\t\t.setup(() => {',
			'\t\t\tstores.setups += 1;',
			'\t\t})',
			'\t\t.cleanup(() => {',
			'\t\t\tstores.cleanups += 1;',
			'\t\t})',
			"\t\t.get('/hmr-backend/greeting', () => greeting())",
			"\t\t.get('/hmr-backend/state', () => `${label()}:${hit()}`)",
			"\t\t.get('/hmr-backend/ticks', () => String(stores.ticks))",
			"\t\t.get('/hmr-backend/lifecycle', () => `${stores.setups}:${stores.cleanups}`)",
			"\t\t.get('/hmr-backend/boots', () => String(stores.boots))",
			"\t\t.get('/hmr-backend/pid', () => String(process.pid))",
			"\t\t.get('/hmr-backend/route', () => 'ROUTE_ONE');",
			''
		].join('\n')
	);
	mutateFile(SERVER, (text) =>
		text
			.replace(
				"import { networking } from '../src/plugins/networking';",
				"import { networking } from '../src/plugins/networking';\nimport { backendRoutes } from './backend/plugin';\nimport { stores } from './backend/stores';\n\nstores.boots += 1;"
			)
			.replace(
				'export const server: AnyElysia = new Elysia()',
				'export const server: AnyElysia = new Elysia()\n\t.use(backendRoutes())'
			)
	);
	server = await startDevServer();
	expect(await get('greeting')).toBe('GREETING_ONE');
}, 120_000);

afterAll(async () => {
	await server?.kill();
	restoreAllFiles();
});

describe('editing server code updates the running server in place', () => {
	test('a handler edit is served quickly, re-running nothing else', async () => {
		const pid = await get('pid');
		const updatesBefore = updateLines().length;
		mutateFile(file('greeting.ts'), (text) =>
			text.replace('GREETING_ONE', 'GREETING_TWO')
		);
		const elapsed = await waitFor('greeting', 'GREETING_TWO');
		expect(elapsed).toBeLessThan(1_500);
		// One save, one update — of that file only.
		await Bun.sleep(300);
		const updates = updateLines().slice(updatesBefore);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain('greeting.ts updated');
		expect(updates[0]).not.toContain('also re-ran');
		expect(await get('pid')).toBe(pid);
		expect(await get('boots')).toBe('1');
		expect(restarted()).toBe(false);
	}, 30_000);

	test('module state survives an edit to its own module', async () => {
		expect(await get('state')).toBe('STATE_ONE:1');
		expect(await get('state')).toBe('STATE_ONE:2');
		mutateFile(file('state.ts'), (text) =>
			text.replace('STATE_ONE', 'STATE_TWO')
		);
		await waitFor('state', 'STATE_TWO:3');
		expect(restarted()).toBe(false);
	}, 30_000);

	test('a plugin edit rebuilds the app, not the rest of the entry', async () => {
		const before = (await get('lifecycle')).split(':').map(Number);
		mutateFile(file('plugin.ts'), (text) =>
			text.replace("'ROUTE_ONE'", "'ROUTE_TWO'")
		);
		await waitFor('route', 'ROUTE_TWO');
		expect(await get('boots')).toBe('1');
		// The replaced app's cleanup ran and the new app's setup ran, once each.
		await Bun.sleep(100);
		const after = (await get('lifecycle')).split(':').map(Number);
		expect(after[0]).toBe((before[0] ?? 0) + 1);
		expect(after[1]).toBe((before[1] ?? 0) + 1);
		expect(restarted()).toBe(false);
	}, 30_000);

	test('an interval edit replaces the interval instead of adding one', async () => {
		const fast = await ticksOver(SAMPLE_MS);
		mutateFile(file('ticker.ts'), (text) =>
			text.replace(`}, ${TICK_MS});`, `}, ${SLOW_TICK_MS});`)
		);
		await waitFor('greeting', 'GREETING_TWO');
		await Bun.sleep(200);
		const slow = await ticksOver(SAMPLE_MS);
		// One interval at 100ms: ~6 ticks. Old plus new would be ~36.
		expect(fast).toBeGreaterThan(15);
		expect(slow).toBeLessThan(12);
		expect(restarted()).toBe(false);
	}, 30_000);

	test('a broken edit keeps the last version serving; the fix applies', async () => {
		mutateFile(file('greeting.ts'), (text) =>
			text.replace(
				'export const greeting = () =>',
				'export const greeting = () => =>'
			)
		);
		await Bun.sleep(800);
		expect(await get('greeting')).toBe('GREETING_TWO');
		expect(restarted()).toBe(false);
		mutateFile(file('greeting.ts'), (text) =>
			text
				.replace(
					'export const greeting = () => =>',
					'export const greeting = () =>'
				)
				.replace('GREETING_TWO', 'GREETING_THREE')
		);
		await waitFor('greeting', 'GREETING_THREE');
		expect(restarted()).toBe(false);
	}, 30_000);
});
