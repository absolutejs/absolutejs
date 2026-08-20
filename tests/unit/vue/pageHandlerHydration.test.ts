import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

describe('handleVuePageRequest hydration', () => {
	test('renders the same multi-root app shape the client hydrates', async () => {
		// Vue runtime-dom captures `document` when its module is first evaluated.
		// The complete Bun suite may import Vue during SSR before this test installs
		// Happy DOM, which permanently leaves runtime-dom's cached document null.
		// Exercise hydration in a clean runtime so test-file order cannot change it.
		const runner = resolve(
			import.meta.dir,
			'../../fixtures/vue-hydration/runtime.ts'
		);
		const subprocess = Bun.spawn([process.execPath, runner], {
			stderr: 'pipe',
			stdout: 'pipe'
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stdout).text(),
			new Response(subprocess.stderr).text()
		]);

		expect(stderr).toBe('');
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toEqual({
			teleported: 'Teleported content',
			warnings: []
		});
	});
});
