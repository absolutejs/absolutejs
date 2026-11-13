import { describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';
import {
	collectErrorHooks,
	hasForeignErrorHook
} from '../../../src/core/appErrorHooks';

/* Builds an AbsoluteJS-like plugin: a few global error hooks of its own,
 * one of them inside a nested plugin (like the not-found and static-error
 * plugins prepare() mounts). */
const nestedRuntimeHook = () => undefined;
const runtimeHook = () => undefined;
const makeRuntime = () => {
	const nested = new Elysia({ name: 'runtime-nested' }).onError(
		'global',
		nestedRuntimeHook
	);

	return new Elysia({ name: 'runtime' })
		.use(nested)
		.onError('global', runtimeHook);
};

/* `listen` runs onStart, which is where the static error plugin captures
 * the app; the hook chain is final by then. */
const startedChain = async (
	build: (runtime: ReturnType<typeof makeRuntime>) => AnyElysia
) => {
	const runtime = makeRuntime();
	let captured: unknown;
	const app = build(runtime).onStart((started) => {
		captured = started;
	});
	app.listen(0);
	await Bun.sleep(20);
	await app.stop();

	return { app: captured, runtime };
};

describe('collectErrorHooks', () => {
	test('finds hooks of the instance and of nested plugins', () => {
		const hooks = collectErrorHooks(makeRuntime());
		expect(hooks.has(runtimeHook)).toBe(true);
		expect(hooks.has(nestedRuntimeHook)).toBe(true);
	});

	test('returns nothing for a value without a hook chain', () => {
		expect(collectErrorHooks(undefined).size).toBe(0);
		expect(collectErrorHooks({}).size).toBe(0);
	});
});

describe('hasForeignErrorHook', () => {
	test('false when every error hook came with the runtime', async () => {
		const { app, runtime } = await startedChain((rt) =>
			new Elysia().use(rt).get('/', () => 'ok')
		);
		expect(hasForeignErrorHook(app, runtime)).toBe(false);
	});

	test('true for an onError registered after .use(runtime)', async () => {
		const { app, runtime } = await startedChain((rt) =>
			new Elysia()
				.use(rt)
				.onError(() => 'mine')
				.get('/', () => 'ok')
		);
		expect(hasForeignErrorHook(app, runtime)).toBe(true);
	});

	test('true for an onError registered before .use(runtime)', async () => {
		const { app, runtime } = await startedChain((rt) =>
			new Elysia()
				.onError(() => 'mine')
				.use(rt)
				.get('/', () => 'ok')
		);
		expect(hasForeignErrorHook(app, runtime)).toBe(true);
	});

	test('true for a global onError inside another plugin', async () => {
		const reporting = new Elysia({ name: 'reporting' }).onError(
			'global',
			() => undefined
		);
		const { app, runtime } = await startedChain((rt) =>
			new Elysia().use([rt, reporting]).get('/', () => 'ok')
		);
		expect(hasForeignErrorHook(app, runtime)).toBe(true);
	});

	test('a local onError inside a sub-plugin is not visible from the app', async () => {
		const api = new Elysia({ name: 'api' })
			.onError(() => undefined)
			.get('/api', () => 'ok');
		const { app, runtime } = await startedChain((rt) =>
			new Elysia().use([rt, api])
		);
		expect(hasForeignErrorHook(app, runtime)).toBe(false);
	});
});
