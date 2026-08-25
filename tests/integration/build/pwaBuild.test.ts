import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const FIXTURE = join(PROJECT_ROOT, 'tests', 'fixtures', 'pwa-build');
let output = '';

afterAll(async () => {
	if (output) await rm(output, { force: true, recursive: true });
});

describe('config-driven PWA build', () => {
	test(
		'builds one shared bootstrap and wires script and static HTML entries',
		async () => {
			output = await mkdtemp(join(FIXTURE, '.build-'));
			const process = Bun.spawn(
				['bun', 'run', join(FIXTURE, 'run.ts'), output],
				{
					cwd: FIXTURE,
					env: { ...globalThis.process.env, TELEMETRY_OFF: '1' },
					stderr: 'pipe',
					stdout: 'pipe'
				}
			);
			const [exitCode, stderr] = await Promise.all([
				process.exited,
				new Response(process.stderr).text()
			]);
			expect(stderr).toBe('');
			expect(exitCode).toBe(0);

			expect(existsSync(join(output, 'sw.js'))).toBe(true);
			expect(
				existsSync(join(output, 'manifest.webmanifest'))
			).toBe(true);
			expect(
				existsSync(join(output, '__absolute', 'pwa', 'bootstrap.js'))
			).toBe(true);
			const worker = await readFile(join(output, 'sw.js'), 'utf8');
			expect(worker).toContain('ABSOLUTE_SYNC_CONFIGURE');

			const html = await readFile(join(output, 'pages', 'index.html'), 'utf8');
			expect(html.match(/data-absolute-pwa/gu)).toHaveLength(1);
			expect(html).toContain('/__absolute/pwa/bootstrap.js');

			const scripts = await readdir(join(output, 'scripts'));
			const main = scripts.find((name) => name.endsWith('.js'));
			expect(main).toBeDefined();
			const bundled = await readFile(join(output, 'scripts', main ?? ''), 'utf8');
			expect(bundled).toContain('/__absolute/pwa/bootstrap.js');
			expect(bundled).toContain('__PWA_BUILD_FIXTURE_STARTED__');
		},
		60_000
	);
});
