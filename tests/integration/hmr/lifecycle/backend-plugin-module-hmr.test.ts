import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { createFile, mutateFile, restoreAllFiles } from '../../../helpers/file';

/* A create-absolutejs app keeps its JSON routes in src/backend/api.ts and
 * passes them to .use() next to its scopedState plugin:
 *
 *   const visitorState = scopedState({ count: { value: 0 } })
 *   export const server = new Elysia().use([absolutejs, api, visitorState])
 *
 * An edit to api.ts (or to a module api.ts imports) must reach the running
 * server through backend HMR, without a restart, keeping every visitor's
 * scopedState. The fixture's folder names a framework ("vue-angular"), as a
 * scaffolded `vue-angular-app` does: a .ts file outside every framework
 * directory is server code however its path reads, so the edit must not be
 * mistaken for an Angular component (with Angular configured) or dropped
 * (without it). */

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const DIR = resolve(PROJECT_ROOT, 'example/vue-angular-backend-hmr');
const SERVER = resolve(DIR, 'server.ts');
const API = resolve(DIR, 'api.ts');
const MESSAGES = resolve(DIR, 'messages.ts');
const NO_ANGULAR_CONFIG = resolve(DIR, 'absolute.config.ts');
const UPDATE_DEADLINE_MS = 8_000;
const POLL_MS = 50;

/* @absolutejs/scoped-state 0.3.1 (what the scaffold installs) keeps its
 * sessions in the closure of the plugin `scopedState()` returns. */
const SCOPED_STATE_0_3 = `import { Elysia, t } from 'elysia';
export const scopedState = (setup) => {
	const initialState = Object.fromEntries(Object.entries(setup).map(([key, entry]) => [key, entry.value]));
	const sessions = new Map();
	return new Elysia({ name: 'scoped-state' })
		.guard('global', { cookie: t.Cookie({ absolute_scoped_state_id: t.Optional(t.String()) }), schema: 'merge' })
		.derive('global', ({ cookie: { absolute_scoped_state_id } }) => {
			let sessionId = absolute_scoped_state_id.value;
			if (typeof sessionId !== 'string' || !sessions.has(sessionId)) {
				sessionId = crypto.randomUUID();
				absolute_scoped_state_id.value = sessionId;
				sessions.set(sessionId, structuredClone(initialState));
			}
			return { scopedStore: sessions.get(sessionId) };
		});
};
`;

const createFixture = () => {
	const pkg = resolve(DIR, 'node_modules/@absolutejs/scoped-state');
	createFile(
		resolve(pkg, 'package.json'),
		'{ "name": "@absolutejs/scoped-state", "version": "0.3.1", "type": "module", "main": "index.js" }\n'
	);
	createFile(resolve(pkg, 'index.js'), SCOPED_STATE_0_3);
	createFile(MESSAGES, "export const pongMessage = 'PONG_ONE'\n");
	createFile(
		API,
		[
			"import { Elysia } from 'elysia'",
			"import { pongMessage } from './messages'",
			'',
			"export const api = new Elysia({ name: 'application-api' })",
			".get('/api/ping', () => 'PING_ONE')",
			".get('/api/pong', () => pongMessage)",
			'export type Api = typeof api',
			''
		].join('\n')
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
			'const { absolutejs } = await prepare()',
			'const visitorState = scopedState({ count: { value: 0 } })',
			'',
			'export const server = new Elysia()',
			'.use([absolutejs, api, visitorState])',
			"  .get('/server/version', () => 'SERVER_ONE')",
			".get('/htmx/count', ({ scopedStore }) => scopedStore.count)",
			".post('/htmx/increment', ({ scopedStore }) => ++scopedStore.count)",
			'  .use(networking)',
			''
		].join('\n')
	);
	createFile(
		NO_ANGULAR_CONFIG,
		[
			"import { defineConfig } from '../../src/utils/defineConfig'",
			'',
			'export default defineConfig({',
			"	assetsDirectory: 'example/assets',",
			"	buildDirectory: '.test-builds/vue-angular-backend-hmr',",
			"	htmlDirectory: 'example/html',",
			"	htmxDirectory: 'example/htmx',",
			"	publicDirectory: 'example/public',",
			"	stylesConfig: 'example/styles/indexes',",
			"	vueDirectory: 'example/vue'",
			'})',
			''
		].join('\n')
	);
};

const scenario = (name: string, configPath?: string) =>
	describe(name, () => {
		let server: DevServer;
		let cookie = '';
		let edition = 0;

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
				(line) =>
					line.includes('[abs:restart]') ||
					line.includes('restarting')
			);

		beforeAll(async () => {
			createFixture();
			server = await startDevServer({ configPath, serverEntry: SERVER });
		}, 120_000);

		afterAll(async () => {
			await server?.kill();
			restoreAllFiles();
		});

		test('a visitor counts to 2', async () => {
			expect(await request('GET', '/api/ping')).toBe('PING_ONE');
			expect(await request('GET', '/htmx/count')).toBe('0');
			await request('POST', '/htmx/increment');
			expect(await request('POST', '/htmx/increment')).toBe('2');
		}, 30_000);

		test('an edit to the plugin module serves its new route response', async () => {
			edition += 1;
			mutateFile(API, (text) =>
				text.replace('PING_ONE', `PING_EDIT_${edition}`)
			);
			await waitFor('/api/ping', `PING_EDIT_${edition}`);
			expect(await request('GET', '/htmx/count')).toBe('2');
			expect(restarted()).toBe(false);
			expect(
				server.outputLines.some((line) =>
					line.includes(
						'[hmr] server: example/vue-angular-backend-hmr/api.ts updated'
					)
				)
			).toBe(true);
			expect(
				server.outputLines.some((line) => line.includes('[ng-hmr]'))
			).toBe(false);
		}, 30_000);

		test('an edit to a module the plugin imports serves its new value', async () => {
			mutateFile(MESSAGES, (text) =>
				text.replace('PONG_ONE', 'PONG_TWO')
			);
			await waitFor('/api/pong', 'PONG_TWO');
			expect(await request('POST', '/htmx/increment')).toBe('3');
			expect(restarted()).toBe(false);
		}, 30_000);

		test('a later server.ts edit keeps the edited plugin and the count', async () => {
			mutateFile(SERVER, (text) =>
				text.replace('SERVER_ONE', 'SERVER_TWO')
			);
			await waitFor('/server/version', 'SERVER_TWO');
			expect(await request('GET', '/api/ping')).toBe(
				`PING_EDIT_${edition}`
			);
			expect(await request('GET', '/api/pong')).toBe('PONG_TWO');
			expect(await request('GET', '/htmx/count')).toBe('3');
			expect(restarted()).toBe(false);
		}, 30_000);
	});

scenario('backend plugin module HMR with Angular configured');
scenario('backend plugin module HMR without Angular', NO_ANGULAR_CONFIG);
