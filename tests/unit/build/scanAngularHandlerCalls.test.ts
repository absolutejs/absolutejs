import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanAngularHandlerCalls } from '../../../src/build/scanAngularHandlerCalls';

const temporaryDirectories: string[] = [];

const createProject = () => {
	const directory = mkdtempSync(join(tmpdir(), 'absolute-angular-scan-'));
	temporaryDirectories.push(directory);

	return directory;
};

const serverSource = (mountPath: string) => `
	app.get('${mountPath}', () =>
		handleAngularPageRequest({
			pagePath: asset(manifest, 'AngularExample')
		})
	);
`;

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe('scanAngularHandlerCalls', () => {
	test('ignores framework-owned hot-reload entry copies', () => {
		const projectRoot = createProject();
		writeFileSync(
			join(projectRoot, 'server.ts'),
			serverSource('/angular/*')
		);
		writeFileSync(
			join(projectRoot, '.absolutejs-hmr-123-0.ts'),
			serverSource('/angular')
		);

		expect(scanAngularHandlerCalls(projectRoot)).toEqual([
			{
				manifestKey: 'AngularExample',
				mountPath: '/angular/*',
				sourceFile: join(projectRoot, 'server.ts')
			}
		]);
	});

	/* Pinned before the file was restructured to pass the lint, and run
	 * against the old version first. */
	const scanSource = (source: string) => {
		const projectRoot = createProject();
		writeFileSync(join(projectRoot, 'server.ts'), source);

		return scanAngularHandlerCalls(projectRoot).map(
			({ manifestKey, mountPath }) => ({ manifestKey, mountPath })
		);
	};

	test('reads the key and the enclosing route of each call, in source order', () => {
		expect(
			scanSource(`
	app
		.get('/a', () => handleAngularPageRequest({ pagePath: asset(manifest, 'A') }))
		.post("/b/*", async () => {
			const options = { nested: true };
			return handleAngularPageRequest({ 'pagePath': asset(manifest, 'B'), options });
		});
`)
		).toEqual([
			{ manifestKey: 'A', mountPath: '/a' },
			{ manifestKey: 'B', mountPath: '/b/*' }
		]);
	});

	test('a call outside any route has no mount path', () => {
		expect(
			scanSource(`
	const render = () => handleAngularPageRequest({ pagePath: asset(manifest, 'Loose') });
	app.use(plugin).get(pathVariable, render).get('relative', render);
`)
		).toEqual([{ manifestKey: 'Loose', mountPath: null }]);
	});

	test('a spread helper call supplies the key when there is no pagePath', () => {
		expect(
			scanSource(`
	app.get('/s', () => handleAngularPageRequest({ ...pageAssets('Spread'), request }));
`)
		).toEqual([{ manifestKey: 'Spread', mountPath: '/s' }]);
	});

	/* The order of the properties decides: a pagePath written after the
	 * spread replaces it, a spread after a pagePath is ignored, and a
	 * pagePath that is not \`asset(manifest, "…")\` clears what came before. */
	test('a later pagePath wins over a spread, and an unreadable one clears it', () => {
		expect(
			scanSource(`
	app.get('/one', () => handleAngularPageRequest({ ...pageAssets('FromSpread'), pagePath: asset(manifest, 'FromPath') }));
	app.get('/two', () => handleAngularPageRequest({ pagePath: asset(manifest, 'FromPath'), ...pageAssets('FromSpread') }));
	app.get('/three', () => handleAngularPageRequest({ ...pageAssets('FromSpread'), pagePath: computed() }));
	app.get('/four', () => handleAngularPageRequest({ pagePath: computed(), ...pageAssets('AfterUnreadable') }));
`)
		).toEqual([
			{ manifestKey: 'FromPath', mountPath: '/one' },
			{ manifestKey: 'FromPath', mountPath: '/two' },
			{ manifestKey: 'AfterUnreadable', mountPath: '/four' }
		]);
	});

	test('calls with nothing to read a key from are left out', () => {
		expect(
			scanSource(`
	app.get('/a', () => handleAngularPageRequest(options));
	app.get('/b', () => handleAngularPageRequest({ pagePath: asset(manifest, keyVariable) }));
	app.get('/c', () => handleAngularPageRequest({ pagePath: other(manifest, 'C') }));
	app.get('/d', () => handleAngularPageRequest({ ...spreadObject, ...helper() }));
	app.get('/e', () => other.handleAngularPageRequest({ pagePath: asset(manifest, 'E') }));
`)
		).toEqual([]);
	});

	test('skips directories that are not project source', () => {
		const projectRoot = createProject();
		const write = (path: string) => {
			mkdirSync(join(projectRoot, path, '..'), { recursive: true });
			writeFileSync(join(projectRoot, path), serverSource('/x'));
		};
		write('src/server.ts');
		write('node_modules/pkg/server.ts');
		write('dist/server.ts');
		write('.hidden/server.ts');
		write('src/server.js');

		expect(
			scanAngularHandlerCalls(projectRoot).map((call) => call.sourceFile)
		).toEqual([join(projectRoot, 'src/server.ts')]);
	});
});
