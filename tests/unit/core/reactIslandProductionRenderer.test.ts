import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

/* `absolute start` stubs renderToString out of the production server
 * bundle, and React island SSR used it, so a React page with a React island
 * returned 500 in production. The fixture reproduces the stub; it runs in a
 * child process because mock.module is process-wide. */
test('React island SSR works in a server bundle without the legacy renderer', async () => {
	const fixture = resolve(
		import.meta.dir,
		'..',
		'..',
		'fixtures',
		'react-island-prod',
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
