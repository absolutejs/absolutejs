import { expect, test } from 'bun:test';
import { checkElysia2Source } from '../../src/migrate/elysia2';
const check = (body: string) =>
	checkElysia2Source(
		'server.ts',
		`import { Elysia as App } from 'elysia'; const app = new App(); ${body}`
	);

test('blocks legacy routes and lifecycle methods on Elysia chains and aliases', () => {
	for (const body of [
		`app.post('/', ({body}) => body, {body: schema})`,
		`const api = app.prefix('/api'); api.get('/', handler, {query: schema})`,
		`app.route('POST', '/', handler, {body: schema})`,
		`app.ws('/', () => {}, {body: schema})`,
		`app.beforeHandle(() => {}).get('/', () => 'ok')`,
		`app.setup(() => {})`,
		`app.resolve(() => ({user: 1}))`,
		`app.macro('auth', {resolve: handler})`,
		`app.error('Named', Error)`,
		`app.onError('Named', Error)`,
		`app.as('scoped')`,
		`app.onBeforeHandle({as: 'scoped'}, handler)`,
		`new App({aot: false})`
	])
		expect(check(body).length).toBeGreaterThan(0);
});

test("a scoped error hook is valid, and an old named one still isn't", () => {
	for (const scope of ['global', 'local', 'plugin'])
		expect(check(`app.onError('${scope}', handler)`)).toEqual([]);
	expect(check(`app.onError('Named', handler)`)).toHaveLength(1);
});

test('accepts v2 routes and leaves unrelated APIs and prose alone', () => {
	expect(
		check(
			`app.post('/', {body: schema}, handler).get('/', () => 'ok'); app.onError(Error, handler); app.onBeforeHandle(handler); app.onStart(handler); app.derive(handler); app.as('plugin'); app.macro({auth: definition});`
		)
	).toEqual([]);
	expect(
		checkElysia2Source(
			'view.tsx',
			`const app = client; app.post('/', handler, {body: schema}); Promise.resolve(1); query.onError(error); const text = "app.onRequest()";`
		)
	).toEqual([]);
	expect(
		checkElysia2Source(
			'server.ts',
			`import Elysia from 'elysia'; new Elysia().request(handler);`
		)
	).toHaveLength(1);
	expect(
		checkElysia2Source(
			'server.ts',
			`import * as e from 'elysia'; new e.Elysia().error(handler);`
		)
	).toHaveLength(1);
	expect(
		checkElysia2Source('client.ts', `import {treaty} from '@elysiajs/eden'`)
	).toHaveLength(1);
});

test('does not mistake shadowed app or constructor parameters for Elysia', () => {
	expect(
		check(
			`function other(app) { app.onError(handler); app.post('/', handler, {}); }`
		)
	).toEqual([]);
	expect(
		check(`function other(App) { new App().onError(handler); }`)
	).toEqual([]);
});
