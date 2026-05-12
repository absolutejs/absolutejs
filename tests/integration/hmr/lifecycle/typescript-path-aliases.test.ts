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

const startAll = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	return { client: client!, server: server! };
};

/* Vue/Svelte components resolve their `<script setup>` imports via
 * Bun.build's plugin chain, which honours tsconfig
 * `compilerOptions.paths`. This test adds a path alias for the Vue
 * composable directory, rewrites a `.vue` file's import to use the
 * alias, and confirms:
 *   1. SSR renders the page without error (alias resolved cleanly).
 *   2. HMR still fires on edits to the aliased composable.
 *
 * Angular pipeline path-alias support exists in
 * `readTsconfigPathAliases` (compileAngular.ts) but currently
 * causes a separate `@angular/core` resolution path that trips
 * NG0203 at SSR — that's a pre-existing bug tracked separately;
 * Vue's path is the canonical alias-works contract. */
describe('TypeScript tsconfig.json paths/baseUrl alias resolution (Vue)', () => {
	test(
		'aliased composable import resolves at compile time and SSR renders cleanly',
		async () => {
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
		},
		60_000
	);

	test(
		'editing the alias-imported `.vue` file (its own source) still triggers HMR',
		async () => {
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
		},
		60_000
	);
});
