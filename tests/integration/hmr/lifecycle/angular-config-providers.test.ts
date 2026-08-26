import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
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

const appProvidersSource = resolve(
	PROJECT_ROOT,
	'example/angular/appProviders.ts'
);
const angularExamplePage = resolve(
	PROJECT_ROOT,
	'example/angular/pages/angular-example.ts'
);
const exampleServer = resolve(PROJECT_ROOT, 'example/server.ts');
const compiledAngularExample = resolve(
	PROJECT_ROOT,
	'.absolutejs/generated/angular/pages/angular-example.js'
);
const REBUILD_TIMEOUT_MS = 60_000;

const startAndConnect = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();

	return server;
};

const waitForGeneratedContent = async (
	path: string,
	predicate: (content: string) => boolean
) => {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const content = readFileSync(path, 'utf-8');
			if (predicate(content)) return content;
		} catch {
			// The bundler replaces generated files atomically; retry while the
			// current cycle owns the path.
		}
		await Bun.sleep(50);
	}
	throw new Error(`Timed out waiting for generated Angular output: ${path}`);
};

const mutateAndWaitForRebuild = async (c: HMRClient, mutate: () => void) => {
	c.drain();
	const rebuildStarted = c.waitFor('rebuild-start', REBUILD_TIMEOUT_MS);
	// Non-decorated provider edits take the Tier-1 rebootstrap path. That
	// signal must not be emitted until every serialized bundle cycle has
	// completed and the generated SSR graph is stable.
	const rebootstrapCompleted = c.waitFor(
		'angular:rebootstrap',
		REBUILD_TIMEOUT_MS
	);
	mutate();
	await rebuildStarted;
	try {
		await rebootstrapCompleted;
	} catch (error) {
		const messages = c.messages.map((message) => ({
			data: message.data,
			type: message.type
		}));
		throw new Error(
			`${error instanceof Error ? error.message : String(error)}\n` +
				`HMR messages: ${JSON.stringify(messages)}\n` +
				`Dev server output:\n${server?.outputLines.slice(-30).join('\n') ?? '(server unavailable)'}`,
			{ cause: error }
		);
	}
};

/* The build's providers-injection step (in `compileAngular.ts`)
 * appends `export const providers = [...appProviders, provideRouter(
 * routes, ...), { APP_BASE_HREF }]` directly into each page's
 * compiled server output. The four scenarios below are the
 * regression class the providers refactor needs to survive: an edit
 * to the global providers source, an edit to a page's `routes`
 * export, an edit to the Elysia mount path the page sits under, and
 * a transitive component-chain edit reachable through the providers
 * binding. Each one routes through the HMR rebuild path that
 * re-runs `runAngularHandlerScan` + `parseAngularProvidersImport`
 * before invoking `compileAngular`, so the injected providers
 * always reflect the current source state.
 *
 * Most assertions target the compiled `.js` artifact directly —
 * the providers injection is a string transform on the page
 * server output and reading that output is the most stable signal
 * that the build saw the edit. The transitive-component test does
 * a full SSR fetch since its regression mode is a runtime
 * `bootstrapApplication` failure, not a compile-time text shape. */
describe('Angular config-driven providers (HMR)', () => {
	test('`appProviders` edit propagates to the page server output on next rebuild', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// The providers source is an implicit dependency of every Angular
		// page. Its edit must expand the rebuild set without requiring an
		// unrelated page mutation to prime the dependency graph.
		await mutateAndWaitForRebuild(client, () =>
			mutateFile(appProvidersSource, () =>
				[
					"import type { EnvironmentProviders, Provider } from '@angular/core';",
					"import { InjectionToken } from '@angular/core';",
					'',
					"export const FROM_APP_PROVIDERS = new InjectionToken<string>('FROM_APP_PROVIDERS');",
					'',
					'export const appProviders: ReadonlyArray<Provider | EnvironmentProviders> = [',
					"	{ provide: FROM_APP_PROVIDERS, useValue: 'config-providers-flow' }",
					'];'
				].join('\n')
			)
		);

		const compiled = readFileSync(compiledAngularExample, 'utf-8');
		// The injection always emits this exact import binding when
		// `angular.providers` resolves.
		expect(compiled).toContain(
			'import { appProviders as __abs_globalProviders } from'
		);
		expect(compiled).toContain('export const providers = [');
		expect(compiled).toContain('...__abs_globalProviders');

		// Sanity-check the page still serves a 200 so the inlined
		// providers chain didn't break SSR boot.
		const response = await fetch(`${srv.baseUrl}/angular`);
		if (response.status !== 200) {
			throw new Error(
				`Angular SSR returned ${response.status}: ${await response.text()}\n\nDev server output:\n${srv.outputLines.slice(-30).join('\n')}`
			);
		}
	}, 120_000);

	test('adding `export const routes` to a page injects provideRouter into its bundle', async () => {
		await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(angularExamplePage, (c) =>
			c.replace(
				"import { Component } from '@angular/core';",
				"import { Component } from '@angular/core';\nimport type { Routes } from '@angular/router';\n\nexport const routes: Routes = [];"
			)
		);
		// Adding `export const routes` to the page changes the
		// providers-injection signature (hasRoutes flips from false →
		// true) but Bun's compile/bundle pipeline runs the wrapper-write
		// step *after* a 2s debounced bundle rebuild on tier-0 surgical
		// edits. The angular HMR broadcast races: a surgical broadcast
		// fires immediately, then `angular-tier-zero-ssr-rebuild-complete`
		// at the end of the rebuilt-bundle pass. We need the *second*
		// one — wait for that specifically so the assertion reads the
		// freshly re-injected output.
		const compiled = await waitForGeneratedContent(
			compiledAngularExample,
			(content) =>
				content.includes(
					'import { provideRouter as __abs_provideRouter'
				)
		);
		// Build appends a router import + a provideRouter() call into
		// the providers literal when the page exports `routes`.
		expect(compiled).toContain(
			'import { provideRouter as __abs_provideRouter'
		);
		expect(compiled).toContain('__abs_provideRouter(routes');
	}, 60_000);

	test('changing the Elysia mount path updates the inferred APP_BASE_HREF in the page bundle', async () => {
		await startAndConnect();
		if (!client) throw new Error('client missing');

		// `/angular` → `/angular/*` is a sub-router mount; the build's
		// AST scan flips the page's basePath from null to '/angular/'
		// and the injection adds `{ provide: APP_BASE_HREF, useValue:
		// "/angular/" }` to the providers literal.
		client.drain();
		const serverEntryReloaded = client.waitFor(
			'server-entry-reloaded',
			15_000
		);
		mutateFile(exampleServer, (c) =>
			c.replace(".get('/angular'", ".get('/angular/*'")
		);
		await serverEntryReloaded;
		// Backend-file edit alone doesn't necessarily kick the angular
		// rebuild. Make a semantic page edit and await its Tier-1 bundle
		// completion so the assertion cannot observe an intermediate
		// generated tree.
		await mutateAndWaitForRebuild(client, () =>
			mutateFile(angularExamplePage, (c) =>
				c.replace(
					"selector: 'angular-page',",
					"selector: 'angular-page-base-href-test',"
				)
			)
		);
		// Same race story as the routes test — surgical-update
		// broadcasts can fire before the bundle rebuild that actually
		// re-applies the providers injection. Wait specifically for
		// the post-bundle broadcast so the assertion reads the
		// rebuilt output.
		const compiled = await waitForGeneratedContent(
			compiledAngularExample,
			(content) =>
				content.includes(
					'{ provide: __abs_APP_BASE_HREF, useValue: "/angular/" }'
				)
		);
		expect(compiled).toContain(
			'import { APP_BASE_HREF as __abs_APP_BASE_HREF } from "@angular/common"'
		);
		expect(compiled).toContain(
			'{ provide: __abs_APP_BASE_HREF, useValue: "/angular/" }'
		);
	}, 120_000);

	test('transitive component edit through the providers chain renders SSR without JIT fetch errors', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// The providers-source edit re-runs the providers-injection scan
		// and compileAngularFileJIT's transitive walk over the chain.
		// The regression class this guards against was the providers chain
		// ending up in a different @angular/core instance than
		// the page bundle — bootstrapApplication's JIT
		// resolveJitResources would then iterate a queue populated
		// from raw `.component.ts` sources whose `templateUrl`s the
		// default fetch-based resourceResolver can't handle, logging
		// `ERR_INVALID_URL` on every first request per process.
		await mutateAndWaitForRebuild(client, () =>
			mutateFile(appProvidersSource, () =>
				[
					"import type { EnvironmentProviders, Provider } from '@angular/core';",
					"import { InjectionToken } from '@angular/core';",
					'',
					"export const TENANT_ID = new InjectionToken<string>('TENANT_ID');",
					'',
					'export const appProviders: ReadonlyArray<Provider | EnvironmentProviders> = [',
					"	{ provide: TENANT_ID, useValue: 'tenant-a' }",
					'];'
				].join('\n')
			)
		);

		const beforeLines = srv.outputLines.length;
		const response = await fetch(`${srv.baseUrl}/angular`);
		if (response.status !== 200) {
			throw new Error(
				`Angular SSR returned ${response.status}: ${await response.text()}\n\nDev server output:\n${srv.outputLines.slice(-30).join('\n')}`
			);
		}
		// Drain stderr/stdout settled while the request was being
		// served and assert nothing in the new lines mentions the
		// regression markers.
		const newOutput = srv.outputLines.slice(beforeLines).join('\n');
		expect(newOutput).not.toContain('ERR_INVALID_URL');
		expect(newOutput).not.toContain('cachedResourceResolve');
		expect(newOutput).not.toContain('NG0201');
		expect(newOutput).not.toContain('NG04014');
	}, 60_000);
});
