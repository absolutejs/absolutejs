import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { BuildConfig } from '../../../types/build';
import {
	renderFileRouteModule,
	scanFileRoutes,
	type ScannedFileRoute
} from '../../../src/build/fileRoutes';

/* A route's form actions, from its server module's source to the plugin
 * the generated route module exports: which modules have them, which
 * names, and the `.post()` each becomes. */

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const PAGE = 'export default function Page() {\n\treturn null;\n}\n';
const ACTION =
	'export const action = defineAction(t.Object({}), () => ({ ok: true }));\n';
const NAMED =
	'export const actions = {\n\tpublish: defineAction(t.Object({}), () => ({ ok: true })),\n\tremove: defineAction(t.Object({}), () => ({ ok: true }))\n};\n';

const FILES: Record<string, string> = {
	'react/routes/about.server.ts': 'export const load = () => ({});\n',
	'react/routes/about.tsx': PAGE,
	'react/routes/blog/[slug].server.ts': `${ACTION}${NAMED}`,
	'react/routes/blog/[slug].tsx': PAGE,
	'react/routes/contact.server.ts': ACTION,
	'react/routes/contact.tsx': PAGE,
	'react/routes/docs/[...rest].server.ts': NAMED,
	'react/routes/docs/[...rest].tsx': PAGE,
	'react/routes/index.server.ts': NAMED,
	'react/routes/index.tsx': PAGE,
	'react/routes/shop/[[category]].server.ts': ACTION,
	'react/routes/shop/[[category]].tsx': PAGE,
	'react/routes/team.server.ts':
		'export const actions = { ...shared, invite };\n',
	'react/routes/team.tsx': PAGE
};

const CONFIG: BuildConfig = { fileRoutes: true, reactDirectory: 'react' };

let project = '';

beforeAll(async () => {
	const parent = join(REPO_ROOT, '.test-builds');
	await mkdir(parent, { recursive: true });
	project = await mkdtemp(join(parent, 'file-route-actions-'));
	await Promise.all(
		Object.entries(FILES).map(([path, contents]) =>
			Bun.write(join(project, path), contents)
		)
	);
});

afterAll(async () => {
	// Leave the process-wide registry empty for the next test file.
	scanFileRoutes({});
	await rm(project, { force: true, recursive: true });
});

const scan = () => scanFileRoutes(CONFIG, project);

const routeAt = (path: string) => {
	const route = scan().routes.find((candidate) => candidate.path === path);
	if (!route) throw new Error(`no route for ${path}`);

	return route;
};

describe('the actions a route is found to have', () => {
	test('its own, when the server module exports `action`', () => {
		expect(routeAt('/contact').action).toBe(true);
		expect(routeAt('/contact').actions).toBeUndefined();
	});

	test('its named ones, by name', () => {
		expect(routeAt('/').actions).toEqual(['publish', 'remove']);
		expect(routeAt('/').action).toBeUndefined();
	});

	test('both, from one module', () => {
		const route = routeAt('/blog/:slug');

		expect(route.action).toBe(true);
		expect(route.actions).toEqual(['publish', 'remove']);
	});

	test('none, for a server module that only loads', () => {
		const route = routeAt('/about');

		expect(route.action).toBeUndefined();
		expect(route.actions).toBeUndefined();
	});
});

describe('named actions that cannot be registered', () => {
	const problemFor = (file: string) =>
		scan().problems.find((problem) => problem.includes(file)) ?? '';

	/* `/docs/*` already answers `/docs/anything/_publish`, as the page. */
	test('on a catch-all route are reported, and none is registered', () => {
		expect(problemFor('docs/[...rest].server.ts')).toContain(
			'a catch-all route cannot have named actions'
		);
		expect(routeAt('/docs/*').actions).toBeUndefined();
	});

	test('that cannot be read from the file are reported', () => {
		expect(problemFor('team.server.ts')).toContain('is spread in');
		expect(routeAt('/team').actions).toBeUndefined();
	});
});

describe('the plugin the generated module exports', () => {
	const generated = () =>
		renderFileRouteModule(scan().routes, join(project, 'routes.gen.ts'));

	test('registers a route’s own action on the route’s path', () => {
		expect(generated()).toContain("\t.post('/contact', { form: action");
	});

	test('registers a named action at the route’s path with `/_name` after it', () => {
		const module = generated();

		expect(module).toMatch(
			/\.post\('\/blog\/:slug\/_publish', \{ form: actions\d+\.publish\.form \}, actions\d+\.publish\.handler\)/
		);
		expect(module).toContain(
			".post('/blog/:slug/_remove', { form: actions"
		);
	});

	/* `/` plus `/_publish` is `/_publish`, not `//_publish`. */
	test('puts the root route’s named actions directly under the root', () => {
		const module = generated();

		expect(module).toContain(".post('/_publish', { form: actions");
		expect(module).not.toContain("'//_publish'");
	});

	/* An [[optional]] route is two paths from one file. */
	test('registers an action on each path of an optional route, importing its module once', () => {
		const module = generated();

		expect(module).toContain(".post('/shop', { form: action");
		expect(module).toContain(".post('/shop/:category', { form: action");
		expect(
			module
				.split('\n')
				.filter((line) => line.includes('[[category]].server'))
				.filter((line) => line.startsWith('import {'))
		).toHaveLength(1);
	});

	test('imports a module’s `action` and `actions` together, and only what it has', () => {
		const lines = generated().split('\n');
		const importOf = (file: string) =>
			lines.find(
				(line) => line.startsWith('import {') && line.includes(file)
			) ?? '';

		expect(importOf('blog/[slug].server')).toMatch(
			/^import \{ action as action\d+, actions as actions\d+ \} from/
		);
		expect(importOf('contact.server')).toMatch(
			/^import \{ action as action\d+ \} from/
		);
		expect(importOf('index.server')).toMatch(
			/^import \{ actions as actions\d+ \} from/
		);
		// A module with neither is not imported for its actions.
		expect(importOf('about.server')).toBe('');
	});

	test('is there, and empty, when no route has an action', () => {
		const routes: ScannedFileRoute[] = [];
		const module = renderFileRouteModule(routes, '/app/routes.gen.ts');

		expect(module).toContain(
			"export const routeActions = new Elysia({ name: 'absolutejs-file-route-actions' });"
		);
		expect(module).not.toContain('formActions');
	});
});
