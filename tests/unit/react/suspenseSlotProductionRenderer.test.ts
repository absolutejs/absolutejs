import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

/* `absolute start` stubs renderToStaticMarkup out of the production server
 * bundle, and SuspenseSlot used it to render resolved content, so every
 * SuspenseSlot patch failed in production. The fixture reproduces the stub;
 * it runs in a child process because mock.module is process-wide. */
test('SuspenseSlot works in a server bundle without the legacy renderer', async () => {
	const fixture = resolve(
		import.meta.dir,
		'..',
		'..',
		'fixtures',
		'react-suspense-prod',
		'stubbedLegacyRenderer.tsx'
	);
	const proc = Bun.spawn(['bun', 'test', fixture], {
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [exitCode, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stderr).text()
	]);

	expect(stderr).toContain('1 pass');
	expect(exitCode).toBe(0);
}, 60_000);
