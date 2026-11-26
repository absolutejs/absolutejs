import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Elysia } from 'elysia';
import type { FileRouteDefinition } from '../../../types/fileRoutes';
import {
	renderFileRouteModule,
	scanFileRoutes
} from '../../../src/build/fileRoutes';
import { fileRoutes } from '../../../src/core/fileRoutes';

/* Folder guards from the files on disk to an answered request: the
 * scanner finds each `layout.server.ts`, the generated route module
 * imports them, and the routes it defines refuse or pass a request.
 *
 * The unit tests beside this one cover each of those steps on its own.
 * This joins them, because the seam between them is a generated source
 * file — exactly where a wrong import specifier or a field the adapter
 * never reads would hide. Only guarded-and-refused paths are requested,
 * so no page is ever rendered and no build is needed. */

const REPO_ROOT = resolve(import.meta.dir, '../../..');

const GUARD_BY_KEY = `export const beforeHandle = ({ query, redirect }) =>
	query.key === 'open' ? undefined : redirect('/');
`;
const GUARD_BY_LEVEL = `export const beforeHandle = ({ query }) =>
	query.level === '2'
		? undefined
		: new Response('DEEP_GUARD_REFUSED', { status: 403 });
`;
const PAGE = 'export default function Page() {\n\treturn null;\n}\n';

/* The generated module imports the adapters from the published package
 * name. Here they are pointed at the sources under test instead. */
const ADAPTER_SOURCES: Record<string, string> = {
	"'@absolutejs/absolute'": `'${resolve(REPO_ROOT, 'src/index.ts')}'`,
	"'@absolutejs/absolute/react/server'": `'${resolve(REPO_ROOT, 'src/react/server.ts')}'`
};

let project = '';
let app: { handle: (request: Request) => Promise<Response> };

beforeAll(async () => {
	const parent = join(REPO_ROOT, '.test-builds');
	await mkdir(parent, { recursive: true });
	project = await mkdtemp(join(parent, 'folder-guards-'));
	const files: Record<string, string> = {
		'react/routes/(members)/layout.server.ts': GUARD_BY_KEY,
		'react/routes/(members)/profile.tsx': PAGE,
		'react/routes/open.tsx': PAGE,
		'react/routes/vault/deep/box.tsx': PAGE,
		'react/routes/vault/deep/layout.server.ts': GUARD_BY_LEVEL,
		'react/routes/vault/door.tsx': PAGE,
		'react/routes/vault/layout.server.ts': GUARD_BY_KEY
	};
	await Promise.all(
		Object.entries(files).map(([path, contents]) =>
			Bun.write(join(project, path), contents)
		)
	);

	const cwd = process.cwd();
	process.chdir(project);
	try {
		const { problems, routes } = scanFileRoutes({
			fileRoutes: true,
			reactDirectory: 'react'
		});
		expect(problems).toEqual([]);
		const output = join(process.cwd(), 'src', 'routes.gen.ts');
		const generated = Object.entries(ADAPTER_SOURCES).reduce(
			(source, [from, replacement]) =>
				source.replaceAll(`from ${from}`, `from ${replacement}`),
			renderFileRouteModule(routes, output)
		);
		// Nothing may still name the package: that would load a built
		// copy from `dist/`, and test whatever was built last.
		expect(generated).not.toContain("from '@absolutejs/absolute");
		await Bun.write(output, generated);
		const module: { routeTree: readonly FileRouteDefinition[] } =
			await import(output);
		app = new Elysia().use(fileRoutes(module.routeTree, {}));
	} finally {
		process.chdir(cwd);
		// Leave the process-wide registry empty for the next test file.
		scanFileRoutes({});
	}
});

afterAll(() => rm(project, { force: true, recursive: true }));

const get = (path: string) =>
	app.handle(new Request(`http://localhost${path}`));

describe('a layout.server.ts on disk', () => {
	test('refuses a route in its folder that has no guard of its own', async () => {
		const response = await get('/vault/door');

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/');
	});

	test('a deeper one runs after the outer one let the request through', async () => {
		const outerRefuses = await get('/vault/deep/box?level=2');
		const innerRefuses = await get('/vault/deep/box?key=open');

		expect(outerRefuses.status).toBe(302);
		expect(innerRefuses.status).toBe(403);
		expect(await innerRefuses.text()).toBe('DEEP_GUARD_REFUSED');
	});

	test('in a (group) folder guards the group without a path segment', async () => {
		const response = await get('/profile');

		expect(response.status).toBe(302);
	});
});
