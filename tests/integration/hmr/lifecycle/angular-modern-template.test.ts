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
const dropdownTemplate = resolve(
	PROJECT_ROOT,
	'example/angular/templates/dropdown.component.html'
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
	// Angular tier-0 schedules `runBundle()` 2s-debounced; with cold
	// vendor caches the first bundle can take 10–15s. 30s is well
	// inside the per-test 60s deadline.
	await c.waitFor('angular-tier-zero-ssr-rebuild-complete', 30_000);

	return (await fetch(`${srv.baseUrl}${url}`)).text();
};

/* Modern Angular control-flow blocks (`@if`, `@for`, `@switch`,
 * `@defer`) are parsed by the Angular compiler at JIT time and
 * collapsed into normal NgIf / NgFor-style render instructions;
 * the .html bytes flow through `compileAngularFileJIT`'s template-
 * inline step the same way classic `*ngIf` markup does. So tier
 * selection lands on tier-0 surgical for template-only edits, and
 * the SSR HTML reflects the new control-flow output after the
 * debounced bundle rebuild. Each test edits one block shape and
 * confirms the rendered HTML.
 *
 * Signal() / computed() / effect() live in the component .ts file.
 * Initial-value edits are tier-0 (`field initializer value change`
 * — see angular-tiering.test.ts), so the SSR catch-up path is the
 * same. We exercise the runtime behaviour here: the rendered text
 * reflects the new signal value. */
describe('Angular modern template syntax', () => {
	test('`@if` branch edit re-renders the chosen body', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// Wrap the counter template in an @if. Setting truthy
		// means the body renders; the sentinel inside proves the
		// rebuild evaluated the new control-flow block.
		mutateFile(
			counterTemplate,
			() =>
				`@if (true) {\n\t<button (click)="increment()">\n\t\tcount is <span class="counter-value">{{ count }}</span>\n\t\t<span data-defer-marker>IF_BRANCH_TRUE</span>\n\t</button>\n} @else {\n\t<div>IF_BRANCH_FALSE</div>\n}\n`
		);

		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('IF_BRANCH_TRUE');
		expect(html).not.toContain('IF_BRANCH_FALSE');
	}, 60_000);

	test('`@for` block edit renders every iteration', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(
			counterTemplate,
			() =>
				`<button (click)="increment()">\n\t<span class="counter-value">{{ count }}</span>\n</button>\n@for (n of [1, 2, 3]; track n) {\n\t<span data-for-iter>ITEM_{{ n }}</span>\n}\n`
		);

		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('ITEM_1');
		expect(html).toContain('ITEM_2');
		expect(html).toContain('ITEM_3');
	}, 60_000);

	test('`@switch`/`@case` block edit picks the matching case', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(
			counterTemplate,
			() =>
				`@switch (count) {\n\t@case (0) {\n\t\t<span>SWITCH_ZERO</span>\n\t}\n\t@case (1) {\n\t\t<span>SWITCH_ONE</span>\n\t}\n\t@default {\n\t\t<span>SWITCH_DEFAULT</span>\n\t}\n}\n`
		);

		const html = await waitForBundleAndFetch(client, srv);
		// Initial count = 0 (props default), so @case(0) wins.
		expect(html).toContain('SWITCH_ZERO');
		expect(html).not.toContain('SWITCH_ONE');
		expect(html).not.toContain('SWITCH_DEFAULT');
	}, 60_000);

	test('`@defer` block ships the lowered placeholder marker in SSR', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// AbsoluteJS lowers `@defer` blocks at compile time
		// (`src/angular/lowerDeferSyntax.ts`) into a custom
		// DeferSlot-style placeholder marker so SSR can stream
		// fallback content before the client takes over. The
		// `@placeholder` body is what lands in the SSR HTML.
		// We assert *some* placeholder content materialises;
		// content layout depends on the lowering's emitted
		// directive output.
		mutateFile(
			counterTemplate,
			() =>
				`<button (click)="increment()">\n\t<span class="counter-value">{{ count }}</span>\n</button>\n@defer (on idle) {\n\t<span>DEFER_MAIN</span>\n} @placeholder {\n\t<span data-defer-placeholder>DEFER_PLACEHOLDER</span>\n}\n`
		);

		const html = await waitForBundleAndFetch(client, srv);
		// Either the placeholder content lands directly OR the
		// lowered DeferSlot wrapper element with the inner
		// fallback is present. Both shapes are valid SSR output
		// for AbsoluteJS's defer pipeline.
		const hasPlaceholderText = html.includes('DEFER_PLACEHOLDER');
		const hasDeferWrapper =
			html.includes('data-absolute-slot') ||
			html.includes('data-defer-placeholder');
		expect(hasPlaceholderText || hasDeferWrapper).toBe(true);
	}, 60_000);

	test('`signal()` initial value change reaches SSR', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// Swap the plain class properties for a signal-based
		// counter. The template reads `count()` instead of `count`.
		mutateFile(counterComponent, (c) =>
			c
				.replace(
					"import { Component, Input } from '@angular/core';",
					"import { Component, Input, signal } from '@angular/core';"
				)
				.replace('count: number = 0;', 'count = signal(424242);')
				.replace('this.count = this.initialCount;', '')
				.replace('this.count++;', 'this.count.set(this.count() + 1);')
		);
		mutateFile(
			counterTemplate,
			() =>
				`<button (click)="increment()">\n\t<span class="counter-value">{{ count() }}</span>\n</button>\n`
		);

		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('424242');
	}, 60_000);

	test('`computed()` body change reaches SSR', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(counterComponent, (c) =>
			c
				.replace(
					"import { Component, Input } from '@angular/core';",
					"import { Component, Input, computed, signal } from '@angular/core';"
				)
				.replace(
					'count: number = 0;',
					'count = signal(7);\n\tdoubled = computed(() => this.count() * 11);'
				)
				.replace('this.count = this.initialCount;', '')
				.replace('this.count++;', 'this.count.set(this.count() + 1);')
		);
		mutateFile(
			counterTemplate,
			() =>
				`<button (click)="increment()">\n\t<span class="counter-value">{{ count() }}</span>\n</button>\n<span>DOUBLED_{{ doubled() }}</span>\n`
		);

		const html = await waitForBundleAndFetch(client, srv);
		// signal(7) → doubled() = 7 * 11 = 77
		expect(html).toContain('DOUBLED_77');
	}, 60_000);
});
