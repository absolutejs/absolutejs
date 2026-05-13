import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;
let client: HMRClient | undefined;

afterEach(async () => {
	client?.close();
	client = undefined;
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

const pageComponent = resolve(
	PROJECT_ROOT,
	'example/angular/pages/angular-example.ts'
);
const counterComponent = resolve(
	PROJECT_ROOT,
	'example/angular/components/counter.component.ts'
);

const startAndConnect = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	return server;
};

const waitForBundleAndFetch = async (
	c: HMRClient,
	srv: DevServer,
	url = '/angular'
) => {
	// Bundle rebuild is the debounced angular path:
	// `scheduleAngularBundleRebuild` (2s debounce) → compileAndBundleAngular
	// → ngc traversal + Bun.build over the page module tree. On a cold
	// dev start that compile can clock ~10–15s the very first time it
	// runs (vendor walk + jit-cache populate). 30s is generous but
	// well under the per-test 60s deadline.
	await c.waitFor('angular-tier-zero-ssr-rebuild-complete', 30_000);
	return (await fetch(`${srv.baseUrl}${url}`)).text();
};

/* Angular DI is the framework's runtime backbone — provider trees
 * are wired at element-creation time and existing instances hold
 * resolved values from that wiring. The HMR pipeline has to
 * navigate three classes of DI-related edits:
 *
 *   1. Service / injectable body changes — the service's *logic*
 *      changes but its identity (class reference) is stable.
 *      Consumers that re-render after the bundle rebuild see the
 *      fresh method bodies via the standard SSR import-cache bust.
 *   2. `inject(TOKEN)` site changes — the consumer's wiring shifts
 *      but token identities are stable. SSR rebuilds the bundle
 *      and the next render reads the new value.
 *   3. `@Component({ providers: [...] })` mutations — these reshape
 *      the DI tree at element-creation time, forcing Tier-1b
 *      rebootstrap (covered in angular-tiering.test.ts). Here we
 *      verify the *behavioural* outcome: the SSR-rendered tree
 *      reflects the new provider value.
 *
 * Each test gets its own dev server to keep the fast extractor's
 * fingerprint cache and the watcher's hash table clean — same
 * isolation strategy as `angular-tiering.test.ts`. */
describe('Angular DI + injectables', () => {
	test('`@Component({ providers: [...] })` override changes the SSR-rendered count', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// Page reads `initialCount` from INITIAL_COUNT (provided via
		// page-handler props). Counter pulls it via the @Input chain
		// (page → AppComponent → CounterComponent), so component-level
		// `providers` on the *page* changes the value the counter
		// renders on a fresh SSR request.
		mutateFile(pageComponent, (c) =>
			c.replace(
				'standalone: true,',
				'standalone: true,\n\tproviders: [{ provide: INITIAL_COUNT, useValue: 1337 }],'
			)
		);

		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('count is <span _ngcontent-');
		// The injected override flows through @Input → ngOnInit and
		// CounterComponent renders the value.
		expect(html).toMatch(/count is\s*<span[^>]*>1337<\/span>/);
	}, 60_000);

	test('editing constructor body that reads from inject() changes the SSR value', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(pageComponent, (c) =>
			c.replace(
				'this.initialCount = initialCountToken ?? 0;',
				'this.initialCount = (initialCountToken ?? 0) + 999;'
			)
		);

		const html = await waitForBundleAndFetch(client, srv);
		// Default initialCount is 0 (props), so + 999 = 999.
		expect(html).toMatch(/count is\s*<span[^>]*>999<\/span>/);
	}, 60_000);

	test('declaring + injecting a new InjectionToken flows through to SSR', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(pageComponent, (c) =>
			c
				.replace(
					"export const INITIAL_COUNT = new InjectionToken<number>('INITIAL_COUNT');",
					"export const INITIAL_COUNT = new InjectionToken<number>('INITIAL_COUNT');\nexport const COUNT_MULTIPLIER = new InjectionToken<number>('COUNT_MULTIPLIER', { providedIn: 'root', factory: () => 7 });"
				)
				.replace(
					'this.initialCount = initialCountToken ?? 0;',
					'const multiplier = inject(COUNT_MULTIPLIER);\n\t\tthis.initialCount = (initialCountToken ?? 0) + multiplier * 100;'
				)
		);

		const html = await waitForBundleAndFetch(client, srv);
		// 0 (default) + 7 * 100 = 700.
		expect(html).toMatch(/count is\s*<span[^>]*>700<\/span>/);
	}, 60_000);

	// A new `@Injectable({ providedIn: 'root' })` service file
	// created mid-session combined with a page edit that imports it
	// hits a known race: the watcher batches creation + page edit
	// in one debounce window, the angular fast extractor flips to
	// tier-0 against the service file (which has no prior
	// fingerprint), and the page entry's bundle rebuild is
	// scheduled but the test has trouble catching the broadcast
	// because the service's own tier-0 broadcast can interleave
	// before the bundle rebuild completes. The existing tests above
	// already cover SSR catch-up for DI changes via the
	// `inject()` reading path (test 2) and InjectionToken declaration
	// (test 3); a new providedIn-root service file mid-session is
	// indirectly exercised by `lifecycle/new-component-import.test.ts`'s
	// "new component file + import" pattern. We document the
	// scenario here as a known coverage variant rather than another
	// test.todo, since the SSR semantics are the same as test 2.
});
