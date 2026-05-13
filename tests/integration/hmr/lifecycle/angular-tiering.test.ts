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

/* Angular HMR is tiered:
 *   Tier-0  ⇒ broadcast `angular:component-update` (ɵɵreplaceMetadata)
 *   Tier-1a ⇒ broadcast `angular:component-remount` (createComponent)
 *   Tier-1b ⇒ broadcast `angular:rebootstrap` (full app re-bootstrap)
 *
 * Each tier corresponds to a different shape of edit. The fast
 * extractor in `fastHmrCompiler.ts` decides via a fingerprint over
 * Angular-specific component metadata (inputs, outputs, providers,
 * imports, etc.) — see ComponentFingerprint there for the full set.
 *
 * Each test gets a fresh dev server so the fast extractor's
 * module-level fingerprint cache and the file watcher's hash table
 * start from the same baseline. With a shared server, an
 * afterEach restore races with the next test's mutation and the
 * watcher coalesces both into one cycle whose decided tier is
 * unpredictable. */

const pageComponent = resolve(
	PROJECT_ROOT,
	'example/angular/pages/angular-example.ts'
);
const counterComponent = resolve(
	PROJECT_ROOT,
	'example/angular/components/counter.component.ts'
);
const appComponent = resolve(
	PROJECT_ROOT,
	'example/angular/components/app.component.ts'
);
const dropdownComponent = resolve(
	PROJECT_ROOT,
	'example/angular/components/dropdown.component.ts'
);
const counterTemplate = resolve(
	PROJECT_ROOT,
	'example/angular/templates/counter.component.html'
);

const startAndConnect = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	return { client: client, server: server };
};

/* Wait for whichever angular tier broadcast lands first. The fast
 * extractor produces exactly one per HMR cycle. The deadline is
 * the per-test bun:test deadline — this Promise.race resolves the
 * moment the WebSocket sees the broadcast. */
const waitForAngularTier = (c: HMRClient, deadlineMs = 12_000) =>
	Promise.race([
		c.waitFor('angular:component-update', deadlineMs),
		c.waitFor('angular:component-remount', deadlineMs),
		c.waitFor('angular:rebootstrap', deadlineMs)
	]);

describe('Angular tier-0 surgical (cosmetic guts → ɵɵreplaceMetadata)', () => {
	test('method body change is tier-0', async () => {
		const { client: c } = await startAndConnect();
		mutateFile(counterComponent, (c) =>
			c.replace('this.count++;', 'this.count = this.count + 2;')
		);
		const msg = await waitForAngularTier(c);
		expect(msg.type).toBe('angular:component-update');
	}, 30_000);

	test('external `templateUrl` HTML edit is tier-0', async () => {
		const { client: c } = await startAndConnect();
		mutateFile(counterTemplate, (c) => c.replace('count is', 'tally is'));
		const msg = await waitForAngularTier(c);
		expect(msg.type).toBe('angular:component-update');
	}, 30_000);

	test('field initializer value change is tier-0 (name set unchanged)', async () => {
		const { client: c } = await startAndConnect();
		mutateFile(counterComponent, (c) =>
			c.replace('count: number = 0;', 'count: number = 100;')
		);
		const msg = await waitForAngularTier(c);
		expect(msg.type).toBe('angular:component-update');
	}, 30_000);
});

describe('Angular tier-1a remount (public-API / scoping change → createComponent)', () => {
	test('adding a new `@Input()` field forces remount', async () => {
		const { client: c } = await startAndConnect();
		mutateFile(counterComponent, (c) =>
			c.replace(
				'@Input() initialCount: number = 0;',
				'@Input() initialCount: number = 0;\n\t@Input() multiplier: number = 2;'
			)
		);
		const msg = await waitForAngularTier(c);
		expect(msg.type).toBe('angular:component-remount');
	}, 30_000);

	test('switching `ChangeDetectionStrategy` to OnPush forces remount', async () => {
		const { client: c } = await startAndConnect();
		mutateFile(counterComponent, (c) =>
			c
				.replace(
					"import { Component, Input } from '@angular/core';",
					"import { ChangeDetectionStrategy, Component, Input } from '@angular/core';"
				)
				.replace(
					'@Component({',
					'@Component({\n\tchangeDetection: ChangeDetectionStrategy.OnPush,'
				)
		);
		const msg = await waitForAngularTier(c);
		expect(msg.type).toBe('angular:component-remount');
	}, 30_000);

	test('switching `encapsulation` to ShadowDom forces remount', async () => {
		const { client: c } = await startAndConnect();
		mutateFile(appComponent, (c) =>
			c.replace(
				'encapsulation: ViewEncapsulation.None,',
				'encapsulation: ViewEncapsulation.ShadowDom,'
			)
		);
		const msg = await waitForAngularTier(c);
		expect(msg.type).toBe('angular:component-remount');
	}, 30_000);

	test('adding `host: {...}` bindings forces remount', async () => {
		const { client: c } = await startAndConnect();
		mutateFile(dropdownComponent, (c) =>
			c.replace(
				"selector: 'app-dropdown',",
				"selector: 'app-dropdown',\n\thost: { 'data-test': 'remount-host' },"
			)
		);
		const msg = await waitForAngularTier(c);
		expect(msg.type).toBe('angular:component-remount');
	}, 30_000);
});

describe('Angular tier-1b rebootstrap (structural / DI change → full reboot)', () => {
	test('mutating the `imports: [...]` array forces rebootstrap', async () => {
		const { client: c } = await startAndConnect();
		// Order-sensitive: reordering counts as a structural change
		// (the fast extractor hashes the array text). Reordering
		// here avoids needing a real new component to import.
		mutateFile(appComponent, (c) =>
			c.replace(
				'imports: [CommonModule, CounterComponent],',
				'imports: [CounterComponent, CommonModule],'
			)
		);
		const msg = await waitForAngularTier(c);
		expect(msg.type).toBe('angular:rebootstrap');
	}, 30_000);

	test('adding component-level `providers` forces rebootstrap', async () => {
		const { client: c } = await startAndConnect();
		mutateFile(counterComponent, (c) =>
			c.replace(
				"selector: 'app-counter',",
				"selector: 'app-counter',\n\tproviders: [],"
			)
		);
		const msg = await waitForAngularTier(c);
		expect(msg.type).toBe('angular:rebootstrap');
	}, 30_000);

	test('adding `hostDirectives: []` forces rebootstrap', async () => {
		const { client: c } = await startAndConnect();
		mutateFile(dropdownComponent, (c) =>
			c.replace(
				'standalone: true,',
				'standalone: true,\n\thostDirectives: [],'
			)
		);
		const msg = await waitForAngularTier(c);
		expect(msg.type).toBe('angular:rebootstrap');
	}, 30_000);

	test('editing a `routes` page-level export forces rebootstrap (pageExportsSig)', async () => {
		const { client: c } = await startAndConnect();
		// `routes` is one of the page-level export names the fast
		// extractor fingerprints via `pageExportsSig`. The example
		// page doesn't export `routes` today, so we add one — the
		// presence-or-absence of the export is what flips the hash.
		mutateFile(pageComponent, (c) =>
			c.replace(
				'export const page = defineAngularPage<AngularPageProps>({',
				'export const routes = [];\n\nexport const page = defineAngularPage<AngularPageProps>({'
			)
		);
		const msg = await waitForAngularTier(c);
		expect(msg.type).toBe('angular:rebootstrap');
	}, 30_000);
});
