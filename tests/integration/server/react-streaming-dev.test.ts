import { afterAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { fetchPage, waitForServer } from '../../helpers/http';

const FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'react-streaming-dev'
);
const PORT = 3124;

let proc: ReturnType<typeof Bun.spawn> | undefined;
const baseUrl = `http://localhost:${PORT}`;

afterAll(async () => {
	try {
		proc?.kill();
	} catch {
		// ignore
	}
	await proc?.exited;
});

describe('react streaming in dev server', () => {
	test('setup: start streaming fixture server', async () => {
		proc = Bun.spawn(
			[
				'bun',
				'--hot',
				'--no-clear-screen',
				resolve(FIXTURE, 'server.ts')
			],
			{
				cwd: resolve(import.meta.dir, '..', '..', '..'),
				env: {
					...process.env,
					ABSOLUTE_CONFIG: resolve(FIXTURE, 'absolute.config.ts'),
					FORCE_COLOR: '0',
					NODE_ENV: 'development',
					PORT: String(PORT),
					TELEMETRY_OFF: '1'
				},
				stderr: 'pipe',
				stdout: 'pipe'
			}
		);

		await waitForServer(`${baseUrl}/hmr-status`, 60, 250);
		expect(proc).toBeDefined();
	}, 120_000);

	test('injects runtime and both slot patches into the raw HTML response', async () => {
		const { html, status } = await fetchPage(baseUrl);
		const fastPatchIndex = html.indexOf('"fixture-fast"');
		const slowPatchIndex = html.indexOf('"fixture-slow"');

		expect(status).toBe(200);
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="fixture-fast"');
		expect(html).toContain('id="fixture-slow"');
		expect(html).toContain('fixture fast resolved');
		expect(html).toContain('fixture slow resolved');
		expect(fastPatchIndex).toBeGreaterThan(-1);
		expect(slowPatchIndex).toBeGreaterThan(-1);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});
});
