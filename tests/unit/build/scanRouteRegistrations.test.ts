import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scanRouteRegistrations } from '../../../src/build/scanRouteRegistrations';

/* The static scan the sitemap and the link audit read route tables from.
 * It had no tests of its own. Written before the file was restructured
 * to pass the lint, and run against the old version first, so what is
 * pinned here is what it did. */

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const project = async (files: Record<string, string>) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-route-scan-'));
	directories.push(root);
	await Promise.all(
		Object.entries(files).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);

	return root;
};

const sorted = (routes: ReturnType<typeof scanRouteRegistrations>) =>
	[...routes].sort((left, right) =>
		`${left.path} ${left.method}`.localeCompare(
			`${right.path} ${right.method}`
		)
	);

describe('scanRouteRegistrations', () => {
	test('finds every method of a chain, with its own arguments only', async () => {
		const root = await project({
			'server.ts': `new Elysia()
	.get('/', () => home(), { sitemap: { priority: 1 } })
	.post('/signin', signIn)
	.delete("/users/:id", ({ params }) => remove(params.id));
`
		});

		expect(sorted(scanRouteRegistrations(root))).toEqual([
			{
				handlerSource: '() => home()\n{ sitemap: { priority: 1 } }',
				method: 'GET',
				path: '/'
			},
			{ handlerSource: 'signIn', method: 'POST', path: '/signin' },
			{
				handlerSource: '({ params }) => remove(params.id)',
				method: 'DELETE',
				path: '/users/:id'
			}
		]);
	});

	/* In source order within a file: the outer call of a chain is the
	 * LAST route written, and it is visited first. */
	test('reports a chain outermost call first', async () => {
		const root = await project({
			'server.ts': "app.get('/a', a).get('/b', b).get('/c', c);\n"
		});

		expect(scanRouteRegistrations(root).map((route) => route.path)).toEqual(
			['/c', '/b', '/a']
		);
	});

	test('every route method, and a path with no handler', async () => {
		const root = await project({
			'server.ts': `app.all('/all').head('/head').options('/options').patch('/patch').put('/put');\n`
		});

		expect(sorted(scanRouteRegistrations(root))).toEqual([
			{ handlerSource: '', method: 'ALL', path: '/all' },
			{ handlerSource: '', method: 'HEAD', path: '/head' },
			{ handlerSource: '', method: 'OPTIONS', path: '/options' },
			{ handlerSource: '', method: 'PATCH', path: '/patch' },
			{ handlerSource: '', method: 'PUT', path: '/put' }
		]);
	});

	test('ignores calls that are not route registrations', async () => {
		const root = await project({
			'server.ts': `map.get('key');
cache.get(\`/template\`, load);
app.get(pathVariable, handler);
app.use('/prefix', plugin);
get('/bare', handler);
app['get']('/computed', handler);
headers.delete('relative/path');
app.get('/real', handler);
`
		});

		expect(scanRouteRegistrations(root)).toEqual([
			{ handlerSource: 'handler', method: 'GET', path: '/real' }
		]);
	});

	test('the same path registered twice is reported twice', async () => {
		const root = await project({
			'api.ts': "api.get('/', list);\n",
			'pages.ts': "pages.get('/', home);\n"
		});

		expect(
			scanRouteRegistrations(root).map((route) => route.handlerSource)
		).toEqual(expect.arrayContaining(['list', 'home']));
		expect(scanRouteRegistrations(root)).toHaveLength(2);
	});

	test('reads TypeScript sources in any directory, and JSX in .tsx', async () => {
		const root = await project({
			'src/a/routes.ts': "app.get('/ts', handler);\n",
			'src/b/routes.mts': "app.get('/mts', handler);\n",
			'src/c/routes.cts': "app.get('/cts', handler);\n",
			'src/d/routes.tsx': "app.get('/tsx', () => <Page />);\n"
		});

		expect(
			scanRouteRegistrations(root)
				.map((route) => route.path)
				.sort()
		).toEqual(['/cts', '/mts', '/ts', '/tsx']);
	});

	test('skips build output, dependencies, dot-directories and other files', async () => {
		const root = await project({
			'.hidden/routes.ts': "app.get('/hidden', handler);\n",
			'build/routes.ts': "app.get('/build', handler);\n",
			'dist/routes.ts': "app.get('/dist', handler);\n",
			'node_modules/pkg/routes.ts': "app.get('/dependency', handler);\n",
			'routes.js': "app.get('/javascript', handler);\n",
			'routes.ts': "app.get('/kept', handler);\n",
			'src/compiled/routes.ts': "app.get('/compiled', handler);\n"
		});

		expect(scanRouteRegistrations(root).map((route) => route.path)).toEqual(
			['/kept']
		);
	});

	test('a root that is not there has no routes', () => {
		expect(
			scanRouteRegistrations(join(tmpdir(), 'absolute-no-such-root'))
		).toEqual([]);
	});
});
