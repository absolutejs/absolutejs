import { describe, expect, test, afterAll } from 'bun:test';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const CONFIG_PATH = resolve(PROJECT_ROOT, 'example/absolute.config.ts');
const SERVER_PATH = resolve(PROJECT_ROOT, 'example/server.ts');
const SVELTE_TYPE_IMPORT_LINE =
	"import type SvelteExample from './svelte/pages/SvelteExample.svelte';\n";
const ANGULAR_TYPE_IMPORT_LINE =
	"import type * as AngularExamplePage from './angular/pages/angular-example';\n";
const SVELTE_IMPORT_LINE =
	"import { handleSveltePageRequest } from '../src/svelte';\n";
const ANGULAR_IMPORT_LINE =
	"import { handleAngularPageRequest } from '../src/angular';\n";
const SVELTE_ROUTE_BLOCK = `\t.get('/svelte', () =>
\t\thandleSveltePageRequest<typeof SvelteExample>({
\t\t\tindexPath: asset(manifest, 'SvelteExampleIndex'),
\t\t\tpagePath: asset(manifest, 'SvelteExample'),
\t\t\tprops: {
\t\t\t\tcssPath: asset(manifest, 'SvelteExampleCSS'),
\t\t\t\tinitialCount: 0
\t\t\t}
\t\t})
\t)
`;
const ANGULAR_ROUTE_BLOCK = `\t.get('/angular', async () =>
\t\thandleAngularPageRequest<typeof AngularExamplePage>({
\t\t\theadTag: generateHeadElement({
\t\t\t\tcssPath: asset(manifest, 'AngularExampleCSS'),
\t\t\t\ttitle: 'AbsoluteJS + Angular'
\t\t\t}),
\t\t\tindexPath: asset(manifest, 'AngularExampleIndex'),
\t\t\tpagePath: asset(manifest, 'AngularExample'),
\t\t\tprops: { initialCount: 0 }
\t\t})
\t)
`;

const originalConfig = readFileSync(CONFIG_PATH, 'utf-8');
const originalServer = readFileSync(SERVER_PATH, 'utf-8');

afterAll(async () => {
	writeFileSync(CONFIG_PATH, originalConfig);
	writeFileSync(SERVER_PATH, originalServer);
});

describe('HMR config change detection', () => {
	test('start server without svelte, verify svelte pages absent from manifest', () => {
		// Remove svelteDirectory from config
		const configWithoutSvelte = originalConfig.replace(
			/\tsvelteDirectory:.*,?\n/,
			''
		);
		const configWithoutSvelteOrAngular = configWithoutSvelte.replace(
			/\tangularDirectory:.*,?\n/,
			''
		);
		writeFileSync(CONFIG_PATH, configWithoutSvelteOrAngular);

		// Remove svelte route + import from server.ts
		let serverWithoutSvelte = originalServer;
		serverWithoutSvelte = serverWithoutSvelte.replace(
			ANGULAR_TYPE_IMPORT_LINE,
			''
		);
		serverWithoutSvelte = serverWithoutSvelte.replace(
			SVELTE_TYPE_IMPORT_LINE,
			''
		);
		serverWithoutSvelte = serverWithoutSvelte.replace(
			ANGULAR_IMPORT_LINE,
			''
		);
		serverWithoutSvelte = serverWithoutSvelte.replace(
			SVELTE_IMPORT_LINE,
			''
		);
		serverWithoutSvelte = serverWithoutSvelte.replace(
			ANGULAR_ROUTE_BLOCK,
			''
		);
		serverWithoutSvelte = serverWithoutSvelte.replace(
			SVELTE_ROUTE_BLOCK,
			''
		);
		if (serverWithoutSvelte === originalServer) {
			throw new Error(
				'Failed to remove Svelte route from example/server.ts'
			);
		}
		writeFileSync(SERVER_PATH, serverWithoutSvelte);

		expect(configWithoutSvelteOrAngular).not.toContain(
			'\tsvelteDirectory:'
		);
		expect(serverWithoutSvelte).not.toContain(
			SVELTE_TYPE_IMPORT_LINE.trim()
		);
		expect(serverWithoutSvelte).not.toContain(SVELTE_IMPORT_LINE.trim());
		expect(serverWithoutSvelte).not.toContain(".get('/svelte', () =>");
		expect(serverWithoutSvelte).toContain(".get('/react', () =>");
	}, 30_000);

	test('restore svelte config and server source for subsequent startup tests', () => {
		writeFileSync(CONFIG_PATH, originalConfig);
		writeFileSync(SERVER_PATH, originalServer);

		const restoredConfig = readFileSync(CONFIG_PATH, 'utf-8');
		const restoredServer = readFileSync(SERVER_PATH, 'utf-8');

		expect(restoredConfig).toContain('\tsvelteDirectory:');
		expect(restoredServer).toContain(SVELTE_TYPE_IMPORT_LINE.trim());
		expect(restoredServer).toContain(SVELTE_IMPORT_LINE.trim());
		expect(restoredServer).toContain(".get('/svelte', () =>");
	});
});
