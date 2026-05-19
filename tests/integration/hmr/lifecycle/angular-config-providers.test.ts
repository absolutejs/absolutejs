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

const startAndConnect = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();

	return server;
};

const waitForBundleRebuild = async (c: HMRClient) => {
	// Page edits that flip component shape land at tier-0/1a and
	// broadcast `angular-tier-zero-ssr-rebuild-complete` when the
	// debounced bundle finishes. Edits to the `appProviders.ts`
	// source go through tier-1b rebootstrap (no decorated class
	// change to extract) and broadcast `angular:rebootstrap` after
	// the bundle write. Both signal "bundle on disk is fresh"; race
	// them so the test isn't coupled to the tier decision.
	await Promise.race([
		c.waitFor('angular-tier-zero-ssr-rebuild-complete', 30_000),
		c.waitFor('angular:rebootstrap', 30_000)
	]);
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

		// Edit the page itself so the angular watcher fires its fast-path
		// — that's the codepath whose providers-injection step we want
		// to verify. The mutation has to actually change a hashable
		// component shape to reach tier-1b structural rebuild and
		// trigger a fresh `compileAndBundleAngular` pass.
		mutateFile(angularExamplePage, (c) =>
			c.replace(
				"selector: 'angular-page',",
				"selector: 'angular-page-providers-test',"
			)
		);
		await waitForBundleRebuild(client);
		// Drain so the providers-source-edit rebuild is the next
		// `angular-tier-zero-ssr-rebuild-complete` `waitFor` resolves on.
		// Without this drain the wait can race-match the page-edit's
		// rebuild and the assertion runs against a tree that hasn't
		// seen the providers edit yet.
		client.drain();
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
		);
		await waitForBundleRebuild(client);

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
		expect(response.status).toBe(200);
	}, 60_000);

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
		await client.waitFor('angular-tier-zero-ssr-rebuild-complete', 30_000);

		const compiled = readFileSync(compiledAngularExample, 'utf-8');
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
		mutateFile(exampleServer, (c) =>
			c.replace(".get('/angular'", ".get('/angular/*'")
		);
		// Backend-file edit alone doesn't necessarily kick the angular
		// rebuild; nudge a page file too so the bundler re-runs over
		// the angular tree.
		mutateFile(angularExamplePage, (c) => `${c}\n`);
		// Same race story as the routes test — surgical-update
		// broadcasts can fire before the bundle rebuild that actually
		// re-applies the providers injection. Wait specifically for
		// the post-bundle broadcast so the assertion reads the
		// rebuilt output.
		await client.waitFor('angular-tier-zero-ssr-rebuild-complete', 30_000);

		const compiled = readFileSync(compiledAngularExample, 'utf-8');
		expect(compiled).toContain(
			'import { APP_BASE_HREF as __abs_APP_BASE_HREF } from "@angular/common"'
		);
		expect(compiled).toContain(
			'{ provide: __abs_APP_BASE_HREF, useValue: "/angular/" }'
		);
	}, 60_000);

	test('transitive component edit through the providers chain renders SSR without JIT fetch errors', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// Page edit first (kicks the angular fast-path), then the
		// providers-source edit (re-runs the providers-injection scan
		// + compileAngularFileJIT's transitive walk over the chain).
		// The regression class this guards against was the providers
		// chain ending up in a different @angular/core instance than
		// the page bundle — bootstrapApplication's JIT
		// resolveJitResources would then iterate a queue populated
		// from raw `.component.ts` sources whose `templateUrl`s the
		// default fetch-based resourceResolver can't handle, logging
		// `ERR_INVALID_URL` on every first request per process.
		mutateFile(angularExamplePage, (c) =>
			c.replace(
				"selector: 'angular-page',",
				"selector: 'angular-page-transitive-test',"
			)
		);
		await waitForBundleRebuild(client);
		client.drain();
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
		);
		await waitForBundleRebuild(client);

		const beforeLines = srv.outputLines.length;
		const response = await fetch(`${srv.baseUrl}/angular`);
		expect(response.status).toBe(200);
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
