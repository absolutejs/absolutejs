import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	installHotResources,
	runAsRequest
} from '../../../../src/dev/hotResources';
import { installHotModulePlugin } from '../../../../src/dev/hot/plugin';
import { applyServerChange } from '../../../../src/dev/hot/reload';
import { rollback } from '../../../../src/dev/hot/runtime';

/* Backend HMR end to end, below the dev server: a small app loaded through
 * the hot runtime, edited, and checked for what changed and what did not
 * (docs/BACKEND_HMR.md). One plugin install serves every test. */

const root = realpathSync(mkdtempSync(join(tmpdir(), 'absolute-backend-hmr-')));
const entry = join(root, 'entry.ts');
const path = (name: string) => join(root, name);
const write = (name: string, source: string) =>
	writeFileSync(path(name), source);
const edit = async (name: string, from: string, to: string) => {
	const source = await Bun.file(path(name)).text();
	if (!source.includes(from)) throw new Error(`${from} not in ${name}`);
	write(name, source.replace(from, to));

	return applyServerChange(path(name), entry);
};

type Counters = Record<string, number>;
declare global {
	var __hotTest: Counters;
}
globalThis.__hotTest = {};
const counter = (name: string) => globalThis.__hotTest[name] ?? 0;
const ENTRY_TAG_BASE = 10_000;
let entryTag = ENTRY_TAG_BASE;
let app: Record<string, unknown> = {};
const loadEntry = async () => {
	entryTag += 1;
	app = Object.fromEntries(
		Object.entries(await import(`${entry}?absolute-hot=${entryTag}`))
	);
};
const call = (name: string, ...args: unknown[]) => {
	const fn = app[name];
	if (typeof fn !== 'function') throw new Error(`${name} is not exported`);

	return fn(...args);
};

beforeAll(async () => {
	write(
		'db.ts',
		'globalThis.__hotTest.pools = (globalThis.__hotTest.pools ?? 0) + 1;\nexport const pool = { id: globalThis.__hotTest.pools };\n'
	);
	write(
		'handler.ts',
		"import { pool } from './db';\nexport const getValue = () => `v1:${pool.id}`;\nexport class Thing { kind = 'thing'; }\n"
	);
	write(
		'plugin.ts',
		"import { getValue } from './handler';\nexport const makeRoutes = () => ({ value: () => getValue(), version: 'p1' });\n"
	);
	write(
		'cycleA.ts',
		"import { b } from './cycleB';\nexport function a() { return 'a'; }\nexport const fromB = b();\n"
	);
	write(
		'cycleB.ts',
		"import { a } from './cycleA';\nexport const viaA = a();\nexport function b() { return 'b'; }\n"
	);
	write(
		'entry.ts',
		[
			"import { pool } from './db';",
			"import { makeRoutes } from './plugin';",
			"import { Thing } from './handler';",
			"import { fromB, viaA } from './cycleA';",
			"import { viaA as viaAFromB } from './cycleB';",
			'export const routes = makeRoutes();',
			'globalThis.__hotTest.entryRuns = (globalThis.__hotTest.entryRuns ?? 0) + 1;',
			'setInterval(() => { globalThis.__hotTest.ticks = (globalThis.__hotTest.ticks ?? 0) + 1; }, 10);',
			'let hits = 0;',
			'export const hit = () => ++hits;',
			'export const poolId = () => pool.id;',
			'export const value = () => routes.value();',
			'export const version = () => routes.version;',
			'export const thing = new Thing();',
			'export const isThing = (value: unknown) => value instanceof Thing;',
			'export const cycle = () => `${fromB}${viaAFromB}`;',
			'export const config = await Promise.resolve({ loadedAt: globalThis.__hotTest.entryRuns });',
			'export const startRequestTimer = () => runRequestWork();',
			'const runRequestWork = () => setTimeout(() => { globalThis.__hotTest.requestTimer = 1; }, 150);',
			''
		].join('\n')
	);
	installHotResources();
	const installed = await installHotModulePlugin({
		configPath: path('absolute.config.ts'),
		entryPath: entry,
		excludedDirs: [],
		root
	});
	if (!installed) throw new Error('backend HMR needs typescript');
	globalThis.__absoluteReloadEntry = async () => {
		try {
			await loadEntry();

			return true;
		} catch {
			await rollback(entry);

			return false;
		}
	};
	await loadEntry();
});

afterAll(() => rmSync(root, { force: true, recursive: true }));

describe('backend HMR', () => {
	test('boots with every module evaluated once, cycles intact', () => {
		expect(call('value')).toBe('v1:1');
		expect(call('cycle')).toBe('ba');
		expect(counter('pools')).toBe(1);
		expect(counter('entryRuns')).toBe(1);
	});

	test('a function edit re-runs only its module', async () => {
		const outcome = await edit('handler.ts', '`v1:', '`v2:');
		expect(outcome.status).toBe('applied');
		expect(outcome.status === 'applied' && outcome.modules).toHaveLength(1);
		expect(call('value')).toBe('v2:1');
		expect(counter('entryRuns')).toBe(1);
		expect(counter('pools')).toBe(1);
	});

	test('a class kept unchanged keeps instanceof working', () => {
		expect(call('isThing', app.thing)).toBe(true);
	});

	test('a factory edit re-runs only the importer statements that called it', async () => {
		const outcome = await edit('plugin.ts', "'p1'", "'p2'");
		expect(outcome.status).toBe('applied');
		expect(outcome.status === 'applied' && outcome.entry).toBe(true);
		expect(call('version')).toBe('p2');
		expect(call('value')).toBe('v2:1');
		expect(counter('entryRuns')).toBe(1);
		expect(counter('pools')).toBe(1);
		expect(app.config).toEqual({ loadedAt: 1 });
	});

	test('module `let` state survives its module re-running', async () => {
		expect(call('hit')).toBe(1);
		expect(call('hit')).toBe(2);
		write(
			'entry.ts',
			(await Bun.file(entry).text()).replace(
				'export const poolId = () => pool.id;',
				'export const poolId = () => pool.id + 0;'
			)
		);
		expect(await globalThis.__absoluteReloadEntry?.('test')).toBe(true);
		expect(call('hit')).toBe(3);
	});

	test('re-running a timer statement stops the replaced timer', async () => {
		const before = counter('ticks');
		await Bun.sleep(100);
		const fast = counter('ticks') - before;
		write(
			'entry.ts',
			(await Bun.file(entry).text()).replace('}, 10);', '}, 50);')
		);
		expect(await globalThis.__absoluteReloadEntry?.('test')).toBe(true);
		await Bun.sleep(20);
		const start = counter('ticks');
		await Bun.sleep(200);
		const slow = counter('ticks') - start;
		expect(fast).toBeGreaterThan(5);
		expect(slow).toBeLessThanOrEqual(5);
		expect(counter('entryRuns')).toBe(1);
	});

	test('work started by a request is not stopped by an edit', async () => {
		runAsRequest(() => call('startRequestTimer'));
		write(
			'entry.ts',
			(await Bun.file(entry).text()).replace(
				'globalThis.__hotTest.requestTimer = 1;',
				'globalThis.__hotTest.requestTimer = 1; /* edited */'
			)
		);
		expect(await globalThis.__absoluteReloadEntry?.('test')).toBe(true);
		await Bun.sleep(250);
		expect(counter('requestTimer')).toBe(1);
	});

	test('a broken edit keeps the previous version; the fix applies', async () => {
		const broken = await edit(
			'handler.ts',
			'export const getValue =',
			'export const getValue = =>'
		);
		expect(broken.status).toBe('failed');
		expect(call('value')).toBe('v2:1');
		const fixed = await edit(
			'handler.ts',
			'export const getValue = =>',
			'export const getValue ='
		);
		expect(fixed.status).toBe('applied');
		expect(call('value')).toBe('v2:1');
	});

	test('a version that throws is rolled back, timers included', async () => {
		const outcome = await edit(
			'handler.ts',
			"export class Thing { kind = 'thing'; }",
			"export class Thing { kind = 'thing'; }\nsetTimeout(() => { globalThis.__hotTest.leaked = 1; }, 100);\nthrow new Error('boom');"
		);
		expect(outcome.status).toBe('failed');
		await Bun.sleep(200);
		expect(counter('leaked')).toBe(0);
		expect(call('value')).toBe('v2:1');
		await edit(
			'handler.ts',
			"\nsetTimeout(() => { globalThis.__hotTest.leaked = 1; }, 100);\nthrow new Error('boom');",
			''
		);
	});

	test('the same source twice is applied once', async () => {
		const outcome = await applyServerChange(path('handler.ts'), entry);
		expect(outcome.status).toBe('unchanged');
	});

	test('a new export is importable by a later edit', async () => {
		await edit(
			'handler.ts',
			'export class Thing',
			"export const extra = () => 'extra';\nexport class Thing"
		);
		const outcome = await edit(
			'plugin.ts',
			"import { getValue } from './handler';",
			"import { extra, getValue } from './handler';\nexport const extraValue = () => extra();"
		);
		expect(outcome.status).toBe('applied');
		const plugin = await import(`${path('plugin.ts')}?absolute-hot=999`);
		expect(plugin.extraValue()).toBe('extra');
	});
});
