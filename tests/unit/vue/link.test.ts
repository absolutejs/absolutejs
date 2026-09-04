import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

describe('Vue <Link>', () => {
	test('prefetches on hover / pointerdown and routes through the page router', async () => {
		// Vue runtime-dom captures `document` when its module is first evaluated,
		// and the complete Bun suite may import Vue during SSR before happy-dom is
		// installed. Exercise the component in a clean runtime instead.
		const runner = resolve(import.meta.dir, '../../fixtures/vue-link/runtime.ts');
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
			external: [],
			// Hover / pointerdown warm the document AND the route data.
			hover: { after: ['/docs', '/docs'], before: [] },
			none: [],
			passthrough: {
				blankPrevented: false,
				metaPrevented: false,
				middlePrevented: false,
				pushed: [],
				unmatchedPrevented: false
			},
			plainClickPrevented: false,
			pointerdown: ['/pricing', '/pricing'],
			push: { prevented: true, pushed: ['/two'] },
			render: { href: '/pricing', text: 'Pricing' },
			replace: { prevented: true, pushed: [], replaced: ['/two'] }
		});
	}, 30_000);
});
