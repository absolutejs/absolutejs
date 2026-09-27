import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	findFreePort,
	isOwnStaleProcess,
	killStaleProcesses
} from '../../../src/cli/utils';

const project = '/work/shop';

test("only this project's own AbsoluteJS server counts as stale", () => {
	const bootstrap =
		'bun --hot --preload /tmp/heap.ts /work/shop/node_modules/@absolutejs/absolute/dist/dev/serverBootstrap.js';
	expect(isOwnStaleProcess(bootstrap, project, project)).toBe(true);
	expect(isOwnStaleProcess('bun run absolute start', project, project)).toBe(
		true
	);
	// Another project's AbsoluteJS server on the same port is not ours.
	expect(
		isOwnStaleProcess(
			bootstrap.replaceAll('/work/shop', '/work/other'),
			'/work/other',
			project
		)
	).toBe(false);
	// Unrelated services are never ours, even in the project directory.
	expect(
		isOwnStaleProcess('postgres -D /var/lib/postgresql', project, project)
	).toBe(false);
	expect(isOwnStaleProcess('node server.js', project, project)).toBe(false);
});

test('an unrelated listener on the port is left running and reported', async () => {
	const port = await findFreePort();
	const elsewhere = realpathSync(
		mkdtempSync(join(tmpdir(), 'unrelated-service-'))
	);
	const service = Bun.spawn(
		[
			'bun',
			'-e',
			`Bun.serve({ port: ${port}, fetch: () => new Response('ok') }); await Bun.sleep(60_000);`
		],
		{ cwd: elsewhere, stderr: 'ignore', stdout: 'ignore' }
	);
	try {
		for (let attempt = 0; attempt < 50; attempt++) {
			const ready = await fetch(`http://127.0.0.1:${port}/`).then(
				() => true,
				() => false
			);
			if (ready) break;
			await Bun.sleep(100);
		}
		const messages: string[] = [];
		killStaleProcesses(port, (message) => messages.push(message));
		await Bun.sleep(300);
		expect(service.exitCode).toBeNull();
		expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe(
			'ok'
		);
		if (messages.length > 0)
			expect(messages.join('\n')).toContain('left running');
	} finally {
		service.kill();
	}
});
