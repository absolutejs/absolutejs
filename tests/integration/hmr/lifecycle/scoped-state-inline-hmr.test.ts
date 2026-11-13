import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { createFile, mutateFile, restoreAllFiles } from '../../../helpers/file';

/* create-absolutejs scaffolds scopedState inline in the statement that
 * builds the app:
 *
 *   export const server = new Elysia()
 *   .use([absolutejs, api, scopedState({"count":{"value":0}})])
 *
 * Editing server.ts or api.ts re-runs that statement under backend HMR,
 * which calls scopedState again. Every visitor's state must survive it. */

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const DIR = resolve(PROJECT_ROOT, 'example/scaffold-scoped-state');
const SERVER = resolve(DIR, 'server.ts');
const API = resolve(DIR, 'api.ts');
const UPDATE_DEADLINE_MS = 8_000;
const POLL_MS = 50;

let server: DevServer;
let cookie = '';

const request = async (method: 'GET' | 'POST', path: string) => {
	const response = await fetch(`${server.baseUrl}${path}`, {
		headers: cookie ? { cookie } : {},
		method
	});
	const setCookie = response.headers.get('set-cookie');
	if (setCookie) cookie = setCookie.split(';')[0] ?? '';

	return response.text();
};

const waitFor = async (path: string, expected: string) => {
	const deadline = Date.now() + UPDATE_DEADLINE_MS;
	let last = '';
	while (Date.now() < deadline) {
		last = await request('GET', path);
		if (last === expected) return;
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

/* The scaffold installs @absolutejs/scoped-state 0.3, which keeps sessions in
 * a closure of the plugin `scopedState()` returns (the repo's own dev copy is
 * 0.2, which keeps them in `app.store` and survives for another reason). This
 * is 0.3.1's implementation, resolved ahead of the repo's copy. */
const SCOPED_STATE_0_3 = `import { Elysia, t } from 'elysia';
export const SCOPED_STATE_COOKIE_NAME = 'absolute_scoped_state_id';
export const scopedState = (setup) => {
	const initialState = Object.fromEntries(Object.entries(setup).map(([key, entry]) => [key, entry.value]));
	const sessions = new Map();
	return new Elysia({ name: 'scoped-state' })
		.guard('global', { cookie: t.Cookie({ absolute_scoped_state_id: t.Optional(t.String()) }), schema: 'merge' })
		.derive('global', ({ cookie: { absolute_scoped_state_id }, status }) => {
			if (!absolute_scoped_state_id) return status('Bad Request', 'Cookies not set properly');
			let sessionId = absolute_scoped_state_id.value;
			if (typeof sessionId !== 'string' || !sessions.has(sessionId)) {
				sessionId = crypto.randomUUID();
				absolute_scoped_state_id.value = sessionId;
				sessions.set(sessionId, structuredClone(initialState));
			}
			const scopedStore = sessions.get(sessionId);
			return {
				scopedStore,
				resetScopedStore: (ignorePreserve) => {
					for (const key in setup) {
						const entry = setup[key];
						if (!entry || (!ignorePreserve && entry.preserve)) continue;
						scopedStore[key] = structuredClone(entry.value);
					}
				}
			};
		});
};
`;

beforeAll(async () => {
	const pkg = resolve(DIR, 'node_modules/@absolutejs/scoped-state');
	createFile(
		resolve(pkg, 'package.json'),
		'{ "name": "@absolutejs/scoped-state", "version": "0.3.1", "type": "module", "main": "index.js" }\n'
	);
	createFile(resolve(pkg, 'index.js'), SCOPED_STATE_0_3);
	createFile(
		API,
		"import { Elysia } from 'elysia'\n\n// Add typed JSON subapps here; keep page rendering and lifecycle in server.ts.\nexport const api = new Elysia({ name: 'application-api' })\n.get('/api/version', () => 'API_ONE')\nexport type Api = typeof api\n"
	);
	createFile(
		SERVER,
		[
			"import { scopedState } from '@absolutejs/scoped-state'",
			"import { Elysia } from 'elysia'",
			"import { prepare } from '../../src'",
			"import { networking } from '../../src/plugins/networking'",
			"import { api } from './api'",
			'',
			'const { absolutejs, manifest } = await prepare()',
			'',
			'export const server = new Elysia()',
			'.use([absolutejs, api, scopedState({"count":{"value":0}})])',
			'',
			"  .get('/server/version', () => 'SERVER_ONE')",
			".post('/htmx/reset', ({ resetScopedStore }) => resetScopedStore())",
			".get('/htmx/count', ({ scopedStore }) => scopedStore.count)",
			".post('/htmx/increment', ({ scopedStore }) => ++scopedStore.count)",
			'  ',
			'  .onError(({ request, error }) => {',
			'    console.error(`Server error on ${request.method} ${request.url}`, error)',
			'  })',
			'  .use(networking)',
			''
		].join('\n')
	);
	server = await startDevServer({ serverEntry: SERVER });
}, 120_000);

afterAll(async () => {
	await server?.kill();
	restoreAllFiles();
});

describe('scopedState created inline in the app statement', () => {
	test('a visitor counts to 3', async () => {
		expect(await request('GET', '/htmx/count')).toBe('0');
		for (let index = 0; index < 3; index += 1)
			await request('POST', '/htmx/increment');
		expect(await request('GET', '/htmx/count')).toBe('3');
	}, 30_000);

	test('the count survives an edit to server.ts', async () => {
		mutateFile(SERVER, (text) => text.replace('SERVER_ONE', 'SERVER_TWO'));
		await waitFor('/server/version', 'SERVER_TWO');
		expect(await request('GET', '/htmx/count')).toBe('3');
		expect(await request('POST', '/htmx/increment')).toBe('4');
		expect(restarted()).toBe(false);
	}, 30_000);

	test('the count survives an edit to api.ts', async () => {
		mutateFile(API, (text) => text.replace('API_ONE', 'API_TWO'));
		await waitFor('/api/version', 'API_TWO');
		expect(await request('GET', '/htmx/count')).toBe('4');
		expect(await request('POST', '/htmx/increment')).toBe('5');
		expect(restarted()).toBe(false);
	}, 30_000);

	test('a new visitor still starts at 0', async () => {
		const visitor = cookie;
		cookie = '';
		expect(await request('GET', '/htmx/count')).toBe('0');
		cookie = visitor;
		expect(await request('GET', '/htmx/count')).toBe('5');
	}, 30_000);
});
