import type {
	PageStore,
	PageStoreEntry,
	PageStoreOptions,
	StoredPage
} from '../../types/pageStore';
import { unrefTimer } from '../utils/unrefTimer';
import type { PageStoreConfig } from '../../types/pageStores';
import { currentPageStore } from './pageStore';
import { pageStoreFromConfig } from './pageStores';
import { filenameToRoute, routeToFilename } from './prerenderPaths';

/* Pre-rendered pages kept in step across machines that share no disk.
 *
 * Each machine serves from its own files, exactly as a single machine
 * does; nothing here is on the path of a request. What this adds is the
 * part a second machine cannot do alone — find out that a page changed
 * somewhere else:
 *
 * - a page this machine re-renders, creates or takes down is also
 *   written to the store;
 * - a machine starting up pulls whatever the store has that it does
 *   not, so one that was down, or was added later, is not serving the
 *   build's pages while the others serve newer ones;
 * - while it runs, it asks the store what changed every few seconds and
 *   pulls that.
 *
 * So a page is rendered once and copied, rather than rendered again on
 * every machine, and the other machines are behind by at most the
 * interval. If the store cannot be reached, pages go on being served and
 * revalidated locally; what stops is the copying, and it resumes.
 *
 * THE STORE IS THE TRUTH. A page whose version there differs from the
 * one this machine last applied is pulled, whichever is "newer": two
 * machines' clocks are not comparable, and a rule that needs them to be
 * would lose a write sooner or later. Two machines revalidating one page
 * at once both write it; the store keeps the last, and both end up with
 * that one.
 *
 * Everything is kept under the build's own id. A page names the hashed
 * assets of the build that rendered it, so a page must never reach a
 * machine running another build. */

const DEFAULT_INTERVAL_MS = 5000;
const PULL_CONCURRENCY = 6;
const KEPT_BUILDS = 3;
const PAGES_SEGMENT = 'pages';
const BUILD_MARKER = '.build';

type LocalPages = {
	/** The page's files as they are on this machine, if it has one. */
	read: (route: string) => Record<string, string> | undefined;
	/** Takes the page down on this machine. */
	remove: (route: string) => void;
	/** Puts a page in place on this machine. */
	write: (route: string, files: Record<string, string>) => Promise<void>;
};

type PageSyncInput = {
	build: string;
	local: LocalPages;
	options?: PageStoreOptions;
	store: PageStore;
	warn: (message: string) => void;
};

type SyncHealth = { failing: boolean };

const describe = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const isStoredPage = (value: unknown): value is StoredPage => {
	if (typeof value !== 'object' || value === null) return false;
	if ('removed' in value && value.removed === true) return true;

	return (
		'files' in value &&
		typeof value.files === 'object' &&
		value.files !== null &&
		Object.values(value.files).every((body) => typeof body === 'string')
	);
};

const parsePage = (body: string | undefined) => {
	if (body === undefined) return undefined;
	try {
		const parsed: unknown = JSON.parse(body);

		return isStoredPage(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
};

/* A few at a time: a machine starting up may have hundreds to pull, and
 * the store is a network service with limits of its own. */
const eachLimited = async <Item>(
	items: readonly Item[],
	work: (item: Item) => Promise<void>
) => {
	const waiting = [...items];
	const next = async (): Promise<void> => {
		const item = waiting.shift();
		if (item === undefined) return;
		await work(item);
		await next();
	};
	await Promise.all(Array.from({ length: PULL_CONCURRENCY }, () => next()));
};

export const createPageSync = ({
	build,
	local,
	options = {},
	store,
	warn
}: PageSyncInput) => {
	const prefix = `${build}/${PAGES_SEGMENT}/`;
	const keyOf = (route: string) => `${prefix}${routeToFilename(route)}`;
	const routeOf = (key: string) => filenameToRoute(key.slice(prefix.length));
	/* The store version of each page this machine has applied. */
	const applied = new Map<string, string>();
	/* Pages being written to the store right now: what the store holds
	 * for them is about to be replaced, so it is not pulled. */
	const pushing = new Set<string>();
	const health: SyncHealth = { failing: false };
	let timer: ReturnType<typeof setInterval> | undefined;

	/* Said when it starts failing and when it recovers, not on every
	 * attempt: a store that is down for an hour is one line, not 720. */
	const reportFailure = (doing: string, error: unknown) => {
		if (health.failing) return;
		health.failing = true;
		warn(
			`The page store could not be reached while ${doing} (${describe(error)}). Pages are still served and revalidated on this machine; changes are not reaching the others, or arriving from them, until it is back.`
		);
	};
	const reportRecovery = () => {
		if (!health.failing) return;
		health.failing = false;
		warn('The page store is reachable again; pages are in step.');
	};

	const push = async (route: string, page: StoredPage) => {
		const key = keyOf(route);
		pushing.add(route);
		try {
			/* Only what the store says IT called this write. Asking the
			 * store afterwards what version it holds is not the same
			 * question: another machine may have written in between,
			 * and this one would then believe it had that machine's
			 * page while still holding its own — and never pull it. A
			 * store that does not say leaves the version unknown, and
			 * the next pull fetches the page back, which is harmless. */
			const version = await store.put(key, JSON.stringify(page));
			if (typeof version === 'string') applied.set(route, version);
			else applied.delete(route);
			reportRecovery();
		} catch (error) {
			reportFailure('sending a page', error);
		} finally {
			pushing.delete(route);
		}
	};

	const apply = async (entry: PageStoreEntry) => {
		const route = routeOf(entry.key);
		const page = parsePage(await store.get(entry.key));
		// Gone between the listing and the read, or not a page at all:
		// nothing to apply, and nothing to remember.
		if (!page || pushing.has(route)) return;
		if (page.removed) local.remove(route);
		else await local.write(route, page.files);
		applied.set(route, entry.version);
	};

	const pull = async () => {
		try {
			const changed = (await store.list(prefix)).filter(
				(entry) =>
					entry.key.startsWith(prefix) &&
					!pushing.has(routeOf(entry.key)) &&
					applied.get(routeOf(entry.key)) !== entry.version
			);
			await eachLimited(changed, apply);
			reportRecovery();

			return changed.length;
		} catch (error) {
			reportFailure('asking what changed', error);

			return 0;
		}
	};

	/* Each build marks the store when it first uses it; the builds
	 * before the last few are removed. The previous ones are kept for
	 * the machines still running them during a rolling deploy. */
	const pruneOldBuilds = async () => {
		const marker = `${build}/${BUILD_MARKER}`;
		if ((await store.get(marker)) === undefined)
			await store.put(marker, new Date().toISOString());
		const everything = await store.list('');
		const markers = everything.filter((entry) =>
			entry.key.endsWith(`/${BUILD_MARKER}`)
		);
		const started = await Promise.all(
			markers.map(async (entry) => ({
				at: (await store.get(entry.key)) ?? '',
				build: entry.key.slice(0, -`/${BUILD_MARKER}`.length)
			}))
		);
		const old = started
			.filter((other) => other.build !== build)
			.sort((one, other) => other.at.localeCompare(one.at))
			.slice(KEPT_BUILDS - 1)
			.map((other) => `${other.build}/`);
		const doomed = everything.filter((entry) =>
			old.some((oldPrefix) => entry.key.startsWith(oldPrefix))
		);
		await eachLimited(doomed, (entry) => store.delete(entry.key));
	};

	return {
		/** Pull what the store has that this machine has not applied.
		 *  Resolves to how many pages changed. */
		pull,
		/** A page this machine re-rendered or created: send it. */
		pushed: async (route: string) => {
			const files = local.read(route);
			if (files) await push(route, { files });
		},
		/** A page this machine took down: tell the others. */
		removed: (route: string) => push(route, { removed: true }),
		/** The first pull, then one every interval. The timer does not
		 *  keep the process alive. */
		start: async () => {
			await pull();
			await pruneOldBuilds().catch((error: unknown) =>
				reportFailure('removing old builds', error)
			);
			timer = setInterval(() => {
				void pull();
			}, options.interval ?? DEFAULT_INTERVAL_MS);
			unrefTimer(timer);
		},
		stop: () => {
			if (timer !== undefined) clearInterval(timer);
			timer = undefined;
		}
	};
};

/* How long a server waits for its first pull before it starts serving
 * anyway. Long enough for a healthy store; short enough that a store
 * that is down does not keep the server from starting. The pull goes on
 * in the background either way. */
const FIRST_PULL_BUDGET_MS = 5000;

type StartPageSyncInput = Omit<PageSyncInput, 'options' | 'store'> & {
	/** `static.store` from the config, used when the app registered no
	 *  store of its own. */
	configured?: PageStoreConfig;
};

/* A store registered in code wins: it is the more specific choice, and
 * the only way to use a client the config cannot describe. */
const chosenStore = (configured: PageStoreConfig | undefined) => {
	const registered = currentPageStore();
	if (registered) return registered;
	if (!configured) return undefined;

	return {
		options:
			configured.interval === undefined
				? {}
				: { interval: configured.interval },
		store: pageStoreFromConfig(configured)
	};
};

/** The sync for the store the app registered, already started — or
 *  `undefined` when it registered none. `ready` settles when the first
 *  pull has finished or its budget has run out. */
export const startPageSync = ({ configured, ...input }: StartPageSyncInput) => {
	const registered = chosenStore(configured);
	if (!registered) return undefined;
	const sync = createPageSync({
		...input,
		options: registered.options,
		store: registered.store
	});
	const started = sync.start();

	return {
		...sync,
		ready: Promise.race([
			started,
			new Promise<void>((resolve) => {
				unrefTimer(setTimeout(resolve, FIRST_PULL_BUDGET_MS));
			})
		])
	};
};
