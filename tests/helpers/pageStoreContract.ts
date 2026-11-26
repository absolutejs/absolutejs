import { describe, expect, test } from 'bun:test';
import type { PageStore } from '../../types/pageStore';
import { createPageSync } from '../../src/core/pageSync';

/* What every page store has to do, as one suite run against each: the
 * stand-in clients in the unit tests, and the real services when a
 * machine has them. A store that passes this works with the sync. */

const sorted = (entries: { key: string }[]) =>
	entries.map((entry) => entry.key).sort();

const machineOn = (store: PageStore, build: string) => {
	const pages = new Map<string, Record<string, string>>();
	const sync = createPageSync({
		build,
		local: {
			read: (route) => pages.get(route),
			remove: (route) => {
				pages.delete(route);
			},
			write: async (route, files) => {
				pages.set(route, files);
			}
		},
		store,
		warn: () => undefined
	});

	return { pages, sync };
};

/** Runs the contract against `makeStore()`, which must hand back a store
 *  that is empty under `space` — a prefix unique to the run. */
export const describePageStoreContract = (
	name: string,
	makeStore: (space: string) => PageStore | Promise<PageStore>
) => {
	const fresh = () => makeStore(`contract-${crypto.randomUUID()}/`);

	describe(`${name}: the page store contract`, () => {
		test('returns what was put, and undefined for what was not', async () => {
			const store = await fresh();

			await store.put(
				'b1/pages/index.html',
				'{"files":{".html":"HOME"}}'
			);

			expect(await store.get('b1/pages/index.html')).toBe(
				'{"files":{".html":"HOME"}}'
			);
			expect(await store.get('b1/pages/missing.html')).toBeUndefined();
		});

		test('keeps a body exactly, whatever is in it', async () => {
			const store = await fresh();
			const body = JSON.stringify({
				files: { '.html': '<p>ünïcödé "quotes" \n newline 🙂 </p>' }
			});

			await store.put('b1/pages/odd.html', body);

			expect(await store.get('b1/pages/odd.html')).toBe(body);
		});

		test('lists by prefix, and only that prefix', async () => {
			const store = await fresh();
			await store.put('b1/pages/index.html', 'a');
			await store.put('b1/pages/blog/hello.html', 'b');
			await store.put('b1/.build', 'c');
			await store.put('b2/pages/index.html', 'd');

			expect(sorted(await store.list('b1/pages/'))).toEqual([
				'b1/pages/blog/hello.html',
				'b1/pages/index.html'
			]);
			expect(sorted(await store.list('b2/'))).toEqual([
				'b2/pages/index.html'
			]);
			expect(sorted(await store.list(''))).toHaveLength(4);
			expect(await store.list('nothing/')).toEqual([]);
		});

		/* More than one page of results: a listing that stopped at the
		 * first page would leave the pages after it never synced. */
		test('lists everything, past one page of results', async () => {
			const store = await fresh();
			const keys = Array.from(
				{ length: 25 },
				(_, index) => `b1/pages/p${String(index).padStart(2, '0')}.html`
			);
			await Promise.all(keys.map((key) => store.put(key, key)));

			expect(sorted(await store.list('b1/pages/'))).toEqual(keys);
		});

		test('a version changes when the object does, and not otherwise', async () => {
			const store = await fresh();
			const versionOf = async () =>
				(await store.list('b1/pages/')).find(
					(entry) => entry.key === 'b1/pages/index.html'
				)?.version;
			await store.put('b1/pages/index.html', 'ONE');
			const first = await versionOf();

			expect(await versionOf()).toBe(first);
			await store.put('b1/pages/index.html', 'TWO');

			expect(await versionOf()).not.toBe(first);
			expect(first).toBeTruthy();
		});

		test('a version put reports is the one list reports', async () => {
			const store = await fresh();

			const reported = await store.put('b1/pages/index.html', 'ONE');
			const [listed] = await store.list('b1/pages/');

			// Saying nothing is allowed; saying something wrong is not.
			if (typeof reported === 'string')
				expect(listed?.version).toBe(reported);
			expect(listed?.key).toBe('b1/pages/index.html');
		});

		test('delete removes an object, and a missing one is not an error', async () => {
			const store = await fresh();
			await store.put('b1/pages/index.html', 'x');

			await store.delete('b1/pages/index.html');
			await store.delete('b1/pages/never-there.html');

			expect(await store.get('b1/pages/index.html')).toBeUndefined();
			expect(await store.list('b1/')).toEqual([]);
		});

		/* The point of all of the above: two machines over this store
		 * end up serving the same pages. */
		test('carries a page, a change and a removal between two machines', async () => {
			const store = await fresh();
			const here = machineOn(store, 'b1');
			const there = machineOn(store, 'b1');

			here.pages.set('/blog/hello', { '.html': 'FIRST' });
			await here.sync.pushed('/blog/hello');
			await there.sync.pull();
			expect(there.pages.get('/blog/hello')).toEqual({
				'.html': 'FIRST'
			});

			here.pages.set('/blog/hello', { '.html': 'SECOND' });
			await here.sync.pushed('/blog/hello');
			await there.sync.pull();
			expect(there.pages.get('/blog/hello')).toEqual({
				'.html': 'SECOND'
			});

			await here.sync.removed('/blog/hello');
			await there.sync.pull();
			expect(there.pages.has('/blog/hello')).toBe(false);
		});

		test('two machines writing one page at once end up the same', async () => {
			const store = await fresh();
			const here = machineOn(store, 'b1');
			const there = machineOn(store, 'b1');
			here.pages.set('/', { '.html': 'FROM HERE' });
			there.pages.set('/', { '.html': 'FROM THERE' });

			await Promise.all([here.sync.pushed('/'), there.sync.pushed('/')]);
			await Promise.all([here.sync.pull(), there.sync.pull()]);

			expect(here.pages.get('/')).toEqual(there.pages.get('/'));
		});
	});
};
