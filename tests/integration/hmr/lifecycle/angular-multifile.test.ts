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

const counterComponent = resolve(
	PROJECT_ROOT,
	'example/angular/components/counter.component.ts'
);
const counterTemplate = resolve(
	PROJECT_ROOT,
	'example/angular/templates/counter.component.html'
);
const appComponent = resolve(
	PROJECT_ROOT,
	'example/angular/components/app.component.ts'
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
	await c.waitFor('angular-tier-zero-ssr-rebuild-complete', 30_000);
	return (await fetch(`${srv.baseUrl}${url}`)).text();
};

/* Angular HMR has to handle edits that cross file boundaries —
 * specifically:
 *
 *   - A change in a child component's template/styles affects what
 *     the *parent* component renders. The dispatcher's
 *     `resolveOwningComponents` walks the dep graph to map a
 *     resource edit back to its owning .ts file, and the fast
 *     extractor's fingerprint cache is keyed per-class so
 *     re-fingerprinting child + parent doesn't cross-contaminate.
 *
 *   - The first edit after dev startup has no prior fingerprint to
 *     compare against. `primeComponentFingerprint` (called by
 *     `compileAndBundleAngular` after the initial compile) seeds
 *     the cache so the first tier decision can compare like-with-
 *     like. Without it, every first-edit-per-component would
 *     undershoot the structural-change branch and silently apply a
 *     tier-0 surgical against a structurally-different definition.
 *
 *   - Concurrent edits to a child + its parent in one save have to
 *     converge — the tier for the parent shouldn't be polluted by
 *     the child's fingerprint, and the resulting SSR should reflect
 *     both edits' effects. */
describe('Angular multi-file edits propagate correctly', () => {
	test('editing counter template (child) reaches /angular SSR (page renders fresh child)', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// Counter's template ships inside AppComponent, which ships
		// inside the page. Editing the leaf-most template must
		// propagate all the way to the page-level SSR HTML.
		mutateFile(counterTemplate, (c) =>
			c.replace('count is', 'A_TO_B_PROPAGATED')
		);

		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('A_TO_B_PROPAGATED');
	}, 60_000);

	test('editing parent (app.component) while child (counter) stays untouched still re-renders subtree', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(appComponent, (c) =>
			c.replace(
				'@Input() initialCount: number = 0;',
				'@Input() initialCount: number = 0;\n\tparentSentinel = "PARENT_RENDERED";'
			)
		);
		const appTemplate = resolve(
			PROJECT_ROOT,
			'example/angular/templates/app.component.html'
		);
		mutateFile(
			appTemplate,
			(c) => `${c}\n<span>{{ parentSentinel }}</span>\n`
		);

		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('PARENT_RENDERED');
		// Child is still rendered too (the @Input(initialCount)
		// flow still wires through).
		expect(html).toContain('count is');
	}, 60_000);

	test('first edit (no prior fingerprint) still picks the correct tier', async () => {
		// This is the `primeComponentFingerprint` smoke test —
		// it verifies that the very first edit to a never-touched
		// component file in a fresh dev session can correctly
		// classify as tier-0 (vs. silently undershooting to a no-
		// op because the fingerprint baseline was undefined).
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// Counter has not been edited yet in this server's lifetime.
		// A pure body change should land tier-0.
		mutateFile(counterComponent, (c) =>
			c.replace('this.count++;', 'this.count = this.count + 3;')
		);

		// Race the three tier broadcasts and require tier-0.
		const tier = await Promise.race([
			client.waitFor('angular:component-update', 20_000),
			client.waitFor('angular:component-remount', 20_000),
			client.waitFor('angular:rebootstrap', 20_000)
		]);
		expect(tier.type).toBe('angular:component-update');
	}, 30_000);

	test('simultaneous edits to two different components both apply', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// Two unrelated mutations in one save: child template
		// content + parent component data. Both should surface
		// in the same SSR pass.
		mutateFile(counterTemplate, (c) =>
			c.replace('count is', 'COUNTER_TEXT_CHANGED')
		);
		mutateFile(appComponent, (c) =>
			c.replace(
				'@Input() initialCount: number = 0;',
				'@Input() initialCount: number = 0;\n\tappSentinel = "APP_TEXT_CHANGED";'
			)
		);
		const appTemplate = resolve(
			PROJECT_ROOT,
			'example/angular/templates/app.component.html'
		);
		mutateFile(
			appTemplate,
			(c) => `${c}\n<span data-app-sentinel>{{ appSentinel }}</span>\n`
		);

		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('COUNTER_TEXT_CHANGED');
		expect(html).toContain('APP_TEXT_CHANGED');
	}, 60_000);
});
