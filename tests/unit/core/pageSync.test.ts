import { describe, expect, test } from 'bun:test';
import type { PageStore } from '../../../types/pageStore';
import { createPageSync } from '../../../src/core/pageSync';

/* Pre-rendered pages kept in step across machines through a store.
 * A "machine" here is a sync with its own in-memory set of pages; the
 * store is one map they all write to, with a switch to make it fail. */

type StoreState = {
	down: boolean;
	/** `put` does not say what version it wrote. */
	silent: boolean;
	writes: number;
};

type StoredObject = { body: string; version: number };

type TestStore = {
	objects: Map<string, StoredObject>;
	reads: string[];
	state: StoreState;
	store: PageStore;
};

const createStore = () => {
	const objects = new Map<string, StoredObject>();
	const reads: string[] = [];
	const state: StoreState = { down: false, silent: false, writes: 0 };
	const reachable = () => {
		if (state.down) throw new Error('connection refused');
	};
	const store: PageStore = {
		delete: async (key) => {
			reachable();
			objects.delete(key);
		},
		get: async (key) => {
			reachable();
			reads.push(key);

			return objects.get(key)?.body;
		},
		list: async (prefix) => {
			reachable();

			return [...objects.entries()]
				.filter(([key]) => key.startsWith(prefix))
				.map(([key, object]) => ({
					key,
					version: String(object.version)
				}));
		},
		put: async (key, body) => {
			reachable();
			state.writes += 1;
			objects.set(key, { body, version: state.writes });

			return state.silent ? undefined : String(state.writes);
		}
	};
	const created: TestStore = { objects, reads, state, store };

	return created;
};

type Machine = {
	pages: Map<string, Record<string, string>>;
	sync: ReturnType<typeof createPageSync>;
	warnings: string[];
};

const createMachine = (
	store: PageStore,
	build = 'build-1',
	interval?: number
) => {
	const pages = new Map<string, Record<string, string>>();
	const warnings: string[] = [];
	const machine: Machine = {
		pages,
		sync: createPageSync({
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
			options: interval === undefined ? {} : { interval },
			store,
			warn: (message) => warnings.push(message)
		}),
		warnings
	};

	return machine;
};

const page = (html: string) => ({ '.html': html, '.meta': '1000' });

/* A machine re-renders a page: it has the new files, then sends them. */
const revalidate = async (machine: Machine, route: string, html: string) => {
	machine.pages.set(route, page(html));
	await machine.sync.pushed(route);
};

describe('a page one machine changes', () => {
	test('reaches another machine on its next pull', async () => {
		const shared = createStore();
		const { store } = shared;
		const here = createMachine(store);
		const there = createMachine(store);

		await revalidate(here, '/blog/hello', 'NEW');
		expect(await there.sync.pull()).toBe(1);

		expect(there.pages.get('/blog/hello')).toEqual(page('NEW'));
	});

	test('travels with every file that makes it up', async () => {
		const shared = createStore();
		const { store } = shared;
		const here = createMachine(store);
		const there = createMachine(store);
		const whole: Record<string, string> = {
			'.holes': 'slot-a\n',
			'.html': 'PAGE',
			'.meta': '1000',
			'.nonce': 'abc',
			'.tags': 'posts\n'
		};
		here.pages.set('/', whole);

		await here.sync.pushed('/');
		await there.sync.pull();

		expect(there.pages.get('/')).toEqual(whole);
	});

	test('is pulled once, not on every pull', async () => {
		const shared = createStore();
		const { store } = shared;
		const here = createMachine(store);
		const there = createMachine(store);
		await revalidate(here, '/blog/hello', 'NEW');

		await there.sync.pull();

		expect(await there.sync.pull()).toBe(0);
	});

	/* The machine that sent a page already has it. */
	test('is not fetched back by the machine that sent it', async () => {
		const shared = createStore();
		const { store } = shared;
		const here = createMachine(store);
		await revalidate(here, '/blog/hello', 'NEW');
		shared.reads.length = 0;

		expect(await here.sync.pull()).toBe(0);
		expect(shared.reads).toEqual([]);
	});

	test('is replaced again when it changes again', async () => {
		const shared = createStore();
		const { store } = shared;
		const here = createMachine(store);
		const there = createMachine(store);
		await revalidate(here, '/blog/hello', 'FIRST');
		await there.sync.pull();

		await revalidate(here, '/blog/hello', 'SECOND');
		await there.sync.pull();

		expect(there.pages.get('/blog/hello')).toEqual(page('SECOND'));
	});
});

describe('a page one machine takes down', () => {
	test('is taken down on the others', async () => {
		const shared = createStore();
		const { store } = shared;
		const here = createMachine(store);
		const there = createMachine(store);
		await revalidate(here, '/blog/gone', 'PAGE');
		await there.sync.pull();
		expect(there.pages.has('/blog/gone')).toBe(true);

		here.pages.delete('/blog/gone');
		await here.sync.removed('/blog/gone');
		await there.sync.pull();

		expect(there.pages.has('/blog/gone')).toBe(false);
	});

	test('can be published again afterwards', async () => {
		const shared = createStore();
		const { store } = shared;
		const here = createMachine(store);
		const there = createMachine(store);
		await revalidate(here, '/blog/post', 'ONE');
		await here.sync.removed('/blog/post');
		await there.sync.pull();

		await revalidate(here, '/blog/post', 'TWO');
		await there.sync.pull();

		expect(there.pages.get('/blog/post')).toEqual(page('TWO'));
	});
});

describe('machines that disagree', () => {
	/* Two machines revalidate one page at the same moment. Whichever
	 * write the store kept is what both must end up serving — no rule
	 * about which is "newer", because their clocks cannot be compared. */
	test('both end up with what the store kept', async () => {
		const shared = createStore();
		const { store } = shared;
		const here = createMachine(store);
		const there = createMachine(store);

		await Promise.all([
			revalidate(here, '/', 'FROM HERE'),
			revalidate(there, '/', 'FROM THERE')
		]);
		await Promise.all([here.sync.pull(), there.sync.pull()]);

		expect(here.pages.get('/')).toEqual(there.pages.get('/'));
	});
});

describe('a store whose put does not say what it wrote', () => {
	/* The writer cannot know its own version, so it fetches its page
	 * back once. That is the whole cost; nothing is lost. */
	test('costs the writer one fetch of its own page, and stays correct', async () => {
		const shared = createStore();
		const { store } = shared;
		shared.state.silent = true;
		const here = createMachine(store);
		const there = createMachine(store);

		await revalidate(here, '/', 'NEW');
		expect(await here.sync.pull()).toBe(1);
		expect(await here.sync.pull()).toBe(0);
		await there.sync.pull();

		expect(here.pages.get('/')).toEqual(page('NEW'));
		expect(there.pages.get('/')).toEqual(page('NEW'));
	});

	test('two machines writing at once still end up the same', async () => {
		const shared = createStore();
		const { store } = shared;
		shared.state.silent = true;
		const here = createMachine(store);
		const there = createMachine(store);

		await Promise.all([
			revalidate(here, '/', 'FROM HERE'),
			revalidate(there, '/', 'FROM THERE')
		]);
		await Promise.all([here.sync.pull(), there.sync.pull()]);

		expect(here.pages.get('/')).toEqual(there.pages.get('/'));
	});
});

describe('a machine that starts late', () => {
	/* It has the build's pages and nothing since. Serving those while
	 * the others serve newer ones is the failure this exists to prevent. */
	test('has every change before it begins', async () => {
		const shared = createStore();
		const { store } = shared;
		const first = createMachine(store);
		await revalidate(first, '/', 'HOME, REVALIDATED');
		await revalidate(first, '/blog/new', 'CREATED AFTER THE BUILD');
		await revalidate(first, '/blog/old', 'OLD');
		await first.sync.removed('/blog/old');

		const late = createMachine(store);
		late.pages.set('/', page('HOME, AS BUILT'));
		late.pages.set('/blog/old', page('OLD, AS BUILT'));
		await late.sync.start();
		late.sync.stop();

		expect(late.pages.get('/')).toEqual(page('HOME, REVALIDATED'));
		expect(late.pages.get('/blog/new')).toEqual(
			page('CREATED AFTER THE BUILD')
		);
		expect(late.pages.has('/blog/old')).toBe(false);
	});

	test('keeps up afterwards on its own, every interval', async () => {
		const shared = createStore();
		const { store } = shared;
		const here = createMachine(store);
		const there = createMachine(store, 'build-1', 10);
		await there.sync.start();

		await revalidate(here, '/', 'CHANGED');
		await Bun.sleep(60);
		there.sync.stop();

		expect(there.pages.get('/')).toEqual(page('CHANGED'));
	});
});

describe('builds', () => {
	/* A page names the hashed assets of the build that rendered it. */
	test('a page never reaches a machine running another build', async () => {
		const shared = createStore();
		const { store } = shared;
		const oldBuild = createMachine(store, 'build-1');
		const newBuild = createMachine(store, 'build-2');

		await revalidate(oldBuild, '/', 'FROM THE OLD BUILD');

		expect(await newBuild.sync.pull()).toBe(0);
		expect(newBuild.pages.has('/')).toBe(false);
	});

	/* The store would otherwise grow by every page of every build
	 * forever. The two builds before the current one are kept, for the
	 * machines still running them during a rolling deploy. */
	test('the store is cleared of builds older than the last few', async () => {
		const shared = createStore();
		const { store } = shared;
		for (const [index, build] of ['b1', 'b2', 'b3', 'b4'].entries()) {
			shared.objects.set(`${build}/.build`, {
				body: `2026-01-0${index + 1}T00:00:00.000Z`,
				version: 0
			});
			shared.objects.set(`${build}/pages/index.html`, {
				body: '{"files":{".html":"x"}}',
				version: 0
			});
		}
		const current = createMachine(store, 'b5');

		await current.sync.start();
		current.sync.stop();

		const builds = new Set(
			[...shared.objects.keys()].map((key) => key.split('/')[0])
		);
		expect([...builds].sort()).toEqual(['b3', 'b4', 'b5']);
	});
});

describe('a store that cannot be reached', () => {
	test('does not stop a machine revalidating, and is reported once', async () => {
		const shared = createStore();
		const { store } = shared;
		const here = createMachine(store);
		shared.state.down = true;

		await revalidate(here, '/', 'ONE');
		await revalidate(here, '/', 'TWO');
		await here.sync.pull();
		await here.sync.pull();

		// Still served from here.
		expect(here.pages.get('/')).toEqual(page('TWO'));
		// One line for the outage, not one per attempt.
		expect(here.warnings).toHaveLength(1);
		expect(here.warnings[0]).toContain('could not be reached');
		expect(here.warnings[0]).toContain('connection refused');
	});

	test('is reported again when it comes back, and the copying resumes', async () => {
		const shared = createStore();
		const { store } = shared;
		const here = createMachine(store);
		const there = createMachine(store);
		shared.state.down = true;
		await there.sync.pull();
		shared.state.down = false;

		await revalidate(here, '/', 'AFTER THE OUTAGE');
		await there.sync.pull();

		expect(there.pages.get('/')).toEqual(page('AFTER THE OUTAGE'));
		expect(there.warnings).toHaveLength(2);
		expect(there.warnings[1]).toContain('reachable again');
	});

	test('does not stop a machine starting', async () => {
		const shared = createStore();
		const { store } = shared;
		shared.state.down = true;
		const here = createMachine(store);
		here.pages.set('/', page('AS BUILT'));

		await here.sync.start();
		here.sync.stop();

		expect(here.pages.get('/')).toEqual(page('AS BUILT'));
	});
});

describe('what is in the store', () => {
	/* Something else wrote under the same prefix, or an object was cut
	 * short. It is not applied, and it does not stop the rest. */
	test('an object that is not a page is passed over', async () => {
		const shared = createStore();
		const { store } = shared;
		const here = createMachine(store);
		const there = createMachine(store);
		shared.objects.set('build-1/pages/broken.html', {
			body: '{ not json',
			version: 99
		});
		shared.objects.set('build-1/pages/wrong.html', {
			body: '{"files":{".html":5}}',
			version: 98
		});
		await revalidate(here, '/good', 'GOOD');

		await there.sync.pull();

		expect([...there.pages.keys()]).toEqual(['/good']);
	});
});
