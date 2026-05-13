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

const tsconfigPath = resolve(PROJECT_ROOT, 'tsconfig.json');
const countButton = resolve(
	PROJECT_ROOT,
	'example/vue/components/CountButton.vue'
);
const counterComp = resolve(
	PROJECT_ROOT,
	'example/angular/components/counter.component.ts'
);

const startAll = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	return { client: client!, server: server! };
};

/* Vue/Svelte/Angular components resolve their imports via the
 * respective compile pipelines (Bun.build's plugin chain for Vue/
 * Svelte; `readTsconfigPathAliases` + `matchTsconfigAlias` in
 * `compileAngular.ts` for Angular), all of which honour tsconfig
 * `compilerOptions.paths`. This test adds path aliases, rewrites
 * imports to use them, and confirms:
 *   1. SSR renders the page without error (alias resolved cleanly).
 *   2. HMR still fires on edits to the aliased source.
 *   3. Angular's SSR doesn't trip NG0203 (the
 *      `verifyAngularCoreUniqueness` build-time guardrail + the
 *      HMR-mode bare-`@angular/*`-specifiers strategy pin Angular
 *      to a single module instance regardless of tsconfig paths). */
describe('TypeScript tsconfig.json paths/baseUrl alias resolution', () => {
	test('aliased composable import resolves at compile time and SSR renders cleanly', async () => {
		// Add path alias to tsconfig BEFORE server boots.
		mutateFile(tsconfigPath, (text) =>
			text.replace(
				'"useDefineForClassFields": false',
				'"useDefineForClassFields": false,\n\t\t"baseUrl": ".",\n\t\t"paths": { "@vue-composables/*": ["example/vue/composables/*"] }'
			)
		);
		// Replace the relative import with the alias.
		mutateFile(countButton, (text) =>
			text.replace(
				"import { useCount } from '../composables/useCount';",
				"import { useCount } from '@vue-composables/useCount';"
			)
		);

		const { server: srv } = await startAll();

		const baseline = await (await fetch(`${srv.baseUrl}/vue`)).text();
		// SSR rendered normally — composable resolved via alias.
		expect(baseline).toContain('count is 0');
		// Sanity: no SSR error page.
		expect(baseline).not.toMatch(/Server Render Error/);
	}, 60_000);

	test('editing the alias-imported `.vue` file (its own source) still triggers HMR', async () => {
		mutateFile(tsconfigPath, (text) =>
			text.replace(
				'"useDefineForClassFields": false',
				'"useDefineForClassFields": false,\n\t\t"baseUrl": ".",\n\t\t"paths": { "@vue-composables/*": ["example/vue/composables/*"] }'
			)
		);
		mutateFile(countButton, (text) =>
			text.replace(
				"import { useCount } from '../composables/useCount';",
				"import { useCount } from '@vue-composables/useCount';"
			)
		);

		const { client: c, server: srv } = await startAll();

		// Now edit the COUNT BUTTON .vue file (the one that
		// does the alias-import). The dep graph still tracks
		// the .vue itself; only the inverse `.ts → .vue`
		// propagation goes through the alias resolver.
		mutateFile(countButton, (text) =>
			text.replace(
				'<button @click="increment">count is {{ count }}</button>',
				'<button @click="increment">tally is {{ count }} (alias-edit)</button>'
			)
		);
		await c.waitFor('vue-tier-zero-ssr-rebuild-complete', 30_000);

		const after = await (await fetch(`${srv.baseUrl}/vue`)).text();
		expect(after).toContain('tally is');
	}, 60_000);

	test('Angular component import via alias resolves at compile time and SSR renders cleanly (no NG0203)', async () => {
		mutateFile(tsconfigPath, (text) =>
			text.replace(
				'"useDefineForClassFields": false',
				'"useDefineForClassFields": false,\n\t\t"baseUrl": ".",\n\t\t"paths": { "@ng-components/*": ["example/angular/components/*"] }'
			)
		);
		// Make counter.component import dropdown via the alias —
		// exercises the matchTsconfigAlias path inside
		// compileAngular.transpileFile.
		mutateFile(counterComp, (text) =>
			text.replace(
				/(import\s+\{[^}]+\}\s+from\s+['"]@angular\/core['"];?)/,
				`$1\nimport '@ng-components/dropdown.component';`
			)
		);

		const { server: srv } = await startAll();
		const res = await fetch(`${srv.baseUrl}/angular`);
		const body = await res.text();

		expect(res.status).toBe(200);
		expect(body).not.toMatch(/Server Render Error/);
		expect(body).toContain('app-counter');
		expect(body).toContain('count is');
		// The NG0203 / two-instance failure mode logs to stderr
		// even when SSR returns a (broken) 200 — assert nothing
		// in that family hit the dev-server output.
		const sawAngularInjectorError = srv.outputLines.some((l) =>
			/NG0203|NG0201|NullInjectorError|Failed to resolve injector/.test(l)
		);
		expect(sawAngularInjectorError).toBe(false);
	}, 60_000);
});
