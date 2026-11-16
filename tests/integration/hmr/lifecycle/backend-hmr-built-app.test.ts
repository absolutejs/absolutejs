import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import {
	createFile,
	mutateFileInPlace,
	restoreAllFiles
} from '../../../helpers/file';

/* An entry that builds its app over several statements, the way a large app
 * does (PAAS: `const platformApplication = new Elysia(…)` then 54
 * `platformApplication.use(…)` statements, then
 * `export const server = platformApplication.use(networking)`).
 *
 * Elysia seals an app at its first request, so a hot update that re-runs one
 * of those `.use(…)` statements against the kept app failed with "[Elysia]
 * .use() called after the app was sealed", and the edit never reached the
 * running server. The statements that build an app now rebuild it, in
 * order, when any of them re-runs. */

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const BACKEND = resolve(PROJECT_ROOT, 'example/backend');
const SERVER = resolve(PROJECT_ROOT, 'example/server.ts');
const file = (name: string) => resolve(BACKEND, name);
const UPDATE_DEADLINE_MS = 8_000;
const POLL_MS = 50;

let server: DevServer;

const get = async (path: string) =>
	(await fetch(`${server.baseUrl}/built-app/${path}`)).text();

const waitFor = async (path: string, expected: string) => {
	const deadline = Date.now() + UPDATE_DEADLINE_MS;
	let last = '';
	while (Date.now() < deadline) {
		last = await get(path);
		if (last === expected) return;
		await Bun.sleep(POLL_MS);
	}
	throw new Error(
		`${path} never answered ${expected} (last: ${last})\n${server.outputLines.slice(-30).join('\n')}`
	);
};

const failures = () =>
	server.outputLines.filter(
		(line) =>
			line.includes('entry re-evaluation failed') ||
			line.includes('failed to update')
	);

beforeAll(async () => {
	createFile(
		file('builtRoutes.ts'),
		[
			"import { Elysia } from 'elysia';",
			'',
			'export const builtRoutes = () =>',
			"\tnew Elysia().get('/built-app/route', () => 'ROUTE_ONE');",
			''
		].join('\n')
	);
	createFile(
		file('builtLabel.ts'),
		"export const builtLabel = () => 'LABEL_ONE';\n"
	);
	mutateFileInPlace(SERVER, (text) =>
		text
			.replace(
				"import { networking } from '../src/plugins/networking';",
				"import { networking } from '../src/plugins/networking';\nimport { builtLabel } from './backend/builtLabel';\nimport { builtRoutes } from './backend/builtRoutes';"
			)
			.replace(
				'export const server: AnyElysia = new Elysia()',
				'const platform: AnyElysia = new Elysia()'
			)
			.replace(
				/\t\.use\(networking\);\s*$/,
				[
					'\t.get(\'/built-app/label\', () => builtLabel());',
					'',
					'platform.use(builtRoutes());',
					'',
					'export const server: AnyElysia = platform.use(networking);',
					''
				].join('\n')
			)
	);
	server = await startDevServer();
	// Serve a request first: that is what seals the app.
	expect(await get('route')).toBe('ROUTE_ONE');
	expect(await get('label')).toBe('LABEL_ONE');
}, 120_000);

afterAll(async () => {
	await server?.kill();
	restoreAllFiles();
});

describe('an entry that builds its app in several statements', () => {
	test('editing what one `.use(…)` statement mounts rebuilds the sealed app', async () => {
		const failuresBefore = failures().length;
		mutateFileInPlace(file('builtRoutes.ts'), (text) =>
			text.replace("'ROUTE_ONE'", "'ROUTE_TWO'")
		);
		await waitFor('route', 'ROUTE_TWO');
		// The rest of the app still serves.
		expect(await get('label')).toBe('LABEL_ONE');
		expect(failures().length).toBe(failuresBefore);
	}, 30_000);

	test('a module and the entry saved together both apply', async () => {
		const failuresBefore = failures().length;
		mutateFileInPlace(file('builtLabel.ts'), (text) =>
			text.replace("'LABEL_ONE'", "'LABEL_TWO'")
		);
		mutateFileInPlace(SERVER, (text) =>
			text.replace(
				"\t.get('/built-app/label', () => builtLabel());",
				"\t.get('/built-app/label', () => builtLabel())\n\t.get('/built-app/entry', () => 'ENTRY_TWO');"
			)
		);
		await waitFor('label', 'LABEL_TWO');
		await waitFor('entry', 'ENTRY_TWO');
		expect(await get('route')).toBe('ROUTE_TWO');
		expect(failures().length).toBe(failuresBefore);
	}, 30_000);
});
