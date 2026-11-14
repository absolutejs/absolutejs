import { describe, expect, test } from 'bun:test';
import {
	createReactUpdateQueue,
	type ReactUpdate,
	type ReactUpdateTiming
} from '../../../src/dev/client/handlers/reactUpdateQueue';

/* The React HMR client applies updates one at a time and always ends on
 * the newest modules, however the imports of overlapping updates settle. */

type Deferred = {
	promise: Promise<unknown>;
	reject: (error: unknown) => void;
	resolve: (value: unknown) => void;
	url: string;
};

type Applied = { modules: unknown[]; update: ReactUpdate };
type Failed = { error: unknown; timings: ReactUpdateTiming[] };

const createHarness = () => {
	const imports: Deferred[] = [];
	const applied: Applied[] = [];
	const appliedTimings: ReactUpdateTiming[][] = [];
	const failed: Failed[] = [];
	const queue = createReactUpdateQueue({
		apply: (update, modules) => {
			applied.push({ modules, update });
		},
		importModule: (url) => {
			const { promise, reject, resolve } =
				Promise.withResolvers<unknown>();
			imports.push({ promise, reject, resolve, url });

			return promise;
		},
		// Every update lands in the same millisecond.
		now: () => 1_000,
		onApplied: (_update, timings) => appliedTimings.push(timings),
		onFailed: (_update, timings, error) => failed.push({ error, timings })
	});

	return { applied, appliedTimings, failed, imports, queue };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const refresh = (moduleUrls: string[], updateId: number): ReactUpdate => ({
	kind: 'refresh',
	moduleUrls,
	updateId
});

describe('React HMR update queue', () => {
	test('a second update for the same save waits and applies once, newest last', async () => {
		const { applied, appliedTimings, imports, queue } = createHarness();
		queue.enqueue(refresh(['/@src/Page.tsx'], 1), 0);
		queue.enqueue(refresh(['/@src/Page.tsx'], 2), 0);
		// Only the first update is loading.
		expect(imports.map(({ url }) => url)).toEqual([
			'/@src/Page.tsx?t=1000'
		]);

		imports[0]?.resolve({ version: 'first' });
		await settle();
		// The first import settled after a newer update arrived: it is not
		// applied on its own; the newer update loads again with a new stamp.
		expect(applied).toEqual([]);
		expect(imports.map(({ url }) => url)).toEqual([
			'/@src/Page.tsx?t=1000',
			'/@src/Page.tsx?t=1001'
		]);

		imports[1]?.resolve({ version: 'second' });
		await settle();
		expect(applied).toEqual([
			{
				modules: [{ version: 'second' }],
				update: refresh(['/@src/Page.tsx'], 2)
			}
		]);
		expect(
			appliedTimings.map((timings) => timings.map((t) => t.updateId))
		).toEqual([[1, 2]]);
		expect(queue.isIdle()).toBe(true);
	});

	test('updates that pile up merge their modules, the newest primary first', async () => {
		const { applied, imports, queue } = createHarness();
		queue.enqueue(refresh(['/@src/A.tsx'], 1), 0);
		queue.enqueue(refresh(['/@src/B.tsx', '/@src/Page.tsx'], 2), 0);
		queue.enqueue(refresh(['/@src/C.tsx', '/@src/Page.tsx'], 3), 0);
		imports[0]?.resolve({});
		await settle();
		expect(imports.slice(1).map(({ url }) => url)).toEqual([
			'/@src/C.tsx?t=1001',
			'/@src/Page.tsx?t=1001',
			'/@src/B.tsx?t=1001',
			'/@src/A.tsx?t=1001'
		]);
		for (const pending of imports.slice(1)) pending.resolve({});
		await settle();
		expect(applied).toHaveLength(1);
		expect(applied[0]?.update.updateId).toBe(3);
	});

	test('updates that do not overlap each apply, with distinct stamps', async () => {
		const { applied, imports, queue } = createHarness();
		for (const updateId of [1, 2, 3]) {
			queue.enqueue(refresh(['/@src/Page.tsx'], updateId), 0);
			imports.at(-1)?.resolve({ updateId });
			await settle();
		}
		expect(applied.map(({ update }) => update.updateId)).toEqual([1, 2, 3]);
		expect(new Set(imports.map(({ url }) => url)).size).toBe(3);
	});

	test('a failed import is retried by a newer update instead of reloading', async () => {
		const { applied, failed, imports, queue } = createHarness();
		queue.enqueue(refresh(['/@src/Page.tsx'], 1), 0);
		queue.enqueue(refresh(['/@src/Page.tsx'], 2), 0);
		imports[0]?.reject(new Error('mid-write'));
		await settle();
		expect(failed).toEqual([]);
		imports[1]?.resolve({});
		await settle();
		expect(applied).toHaveLength(1);
	});

	test('a failed import with nothing newer reports the failure', async () => {
		const { applied, failed, imports, queue } = createHarness();
		queue.enqueue(refresh(['/@src/Page.tsx'], 1), 0);
		imports[0]?.reject(new Error('syntax'));
		await settle();
		expect(applied).toEqual([]);
		expect(failed.map(({ timings }) => timings[0]?.updateId)).toEqual([1]);
		expect(queue.isIdle()).toBe(true);
	});

	test('a remount applies only the newest page module', async () => {
		const { applied, imports, queue } = createHarness();
		queue.enqueue(
			{ kind: 'remount', moduleUrls: ['/@src/Old.tsx'], updateId: 1 },
			0
		);
		queue.enqueue(
			{ kind: 'remount', moduleUrls: ['/@src/Page.tsx'], updateId: 2 },
			0
		);
		imports[0]?.resolve({});
		await settle();
		expect(imports.at(-1)?.url).toBe('/@src/Page.tsx?t=1001');
		imports.at(-1)?.resolve({ page: true });
		await settle();
		expect(applied).toEqual([
			{
				modules: [{ page: true }],
				update: {
					kind: 'remount',
					moduleUrls: ['/@src/Page.tsx'],
					updateId: 2
				}
			}
		]);
	});
});
