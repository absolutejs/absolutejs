import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Elysia } from 'elysia';
import type {
	FileRouteDefinition,
	FileRouteRenderInput
} from '../../../types/fileRoutes';
import { fileRoutes } from '../../../src/core/fileRoutes';
import {
	recordRouteSource,
	routeSourceOf
} from '../../../src/core/routeSources';

/* `absolute routes` lists each route with where it comes from: the file
 * for a file route, the registration call for any other. */

const REPO_ROOT = resolve(import.meta.dir, '../../..');

const renderJson = async ({ props }: FileRouteRenderInput) =>
	Response.json(props);

const pricing: FileRouteDefinition = {
	framework: 'react',
	name: 'RoutePlansPricing',
	path: '/plans/pricing',
	render: renderJson,
	source: 'react/routes/plans/pricing.tsx'
};

describe('the source recorded for a handler', () => {
	test('is read back as recorded, and absent for one never recorded', () => {
		const recorded = () => 'a';
		const unknown = () => 'b';
		recordRouteSource(recorded, {
			kind: 'call',
			location: 'server.ts:4:2'
		});

		expect(routeSourceOf(recorded)).toEqual({
			kind: 'call',
			location: 'server.ts:4:2'
		});
		expect(routeSourceOf(unknown)).toBeUndefined();
		expect(routeSourceOf('not a function')).toBeUndefined();
	});

	/* No registration patch here — this is what a production process
	 * has. The file router names its own files regardless. */
	test('a file route carries its file without the dev patch', () => {
		const app = new Elysia().use(fileRoutes([pricing], {}));
		const route = app.routes.find(
			(candidate) => candidate.path === '/plans/pricing'
		);

		expect(routeSourceOf(route?.handler)).toEqual({
			kind: 'file',
			location: 'react/routes/plans/pricing.tsx'
		});
	});
});

/* The registration patch replaces methods on Elysia's prototype for the
 * whole process, so it is exercised in a process of its own. The script
 * is named the way the dev server names its copy of the server entry,
 * which is the file a stack frame reports. */
describe('under the dev registration patch', () => {
	const ENTRY_COPY = '.absolutejs-hmr-4242-bootstrap-1.ts';
	let directory = '';
	let routes: { method: string; path: string; source: unknown }[] = [];

	beforeAll(async () => {
		/* The directory name has a space in it on purpose. A top-level
		 * registration's stack frame is a bare `at /path:1:2`, and the
		 * parser used to stop at the first space — so on a machine whose
		 * projects live under a path with one, no route had a callsite. */
		const parent = join(REPO_ROOT, '.test-builds');
		await mkdir(parent, { recursive: true });
		directory = await mkdtemp(join(parent, 'route sources-'));
		const from = (path: string) => JSON.stringify(resolve(REPO_ROOT, path));
		await writeFile(
			join(directory, ENTRY_COPY),
			`import { Elysia } from 'elysia';
import { patchElysiaRouteRegistrationCallsites } from ${from('src/core/devRouteRegistrationCallsite.ts')};
import { fileRoutes } from ${from('src/core/fileRoutes.ts')};
import { routeSourceOf } from ${from('src/core/routeSources.ts')};

patchElysiaRouteRegistrationCallsites();

const pricing = {
	framework: 'react',
	name: 'RoutePlansPricing',
	path: '/plans/pricing',
	render: async () => new Response('ok'),
	source: 'react/routes/plans/pricing.tsx'
};
const api = new Elysia({ prefix: '/api' })
	.get('/users', () => 'users');
const app = new Elysia()
	.get('/', () => 'home')
	.use(api)
	.use(fileRoutes([pricing], {}));

console.log(JSON.stringify(app.routes.map((route) => ({
	method: route.method,
	path: route.path,
	source: routeSourceOf(route.handler) ?? null
}))));
`
		);
		const proc = Bun.spawn([process.execPath, ENTRY_COPY], {
			cwd: directory,
			env: {
				...process.env,
				ABSOLUTE_SERVER_ENTRY: join(directory, 'server.ts'),
				NODE_ENV: 'development'
			},
			stderr: 'pipe',
			stdout: 'pipe'
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited
		]);
		if (exitCode !== 0) throw new Error(stderr);
		routes = JSON.parse(stdout.trim().split('\n').at(-1) ?? '[]');
	});

	afterAll(() => rm(directory, { force: true, recursive: true }));

	const sourceOf = (path: string) =>
		routes.find((route) => route.path === path)?.source;

	test('a route names the call that registered it, in the entry and not its copy', () => {
		expect(sourceOf('/')).toEqual({
			kind: 'call',
			location: 'server.ts:18:3'
		});
	});

	test('a prefixed route keeps the source of its own registration', () => {
		expect(sourceOf('/api/users')).toEqual({
			kind: 'call',
			location: 'server.ts:16:3'
		});
	});

	test('a file route names its file, not the router that registered it', () => {
		expect(sourceOf('/plans/pricing')).toEqual({
			kind: 'file',
			location: 'react/routes/plans/pricing.tsx'
		});
	});
});
