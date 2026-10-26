import { afterEach, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';
let server: DevServer | undefined;
afterEach(async () => {
	await server?.kill();
	server = undefined;
	restoreAllFiles();
});
test('a root dependency manifest edit reaches the dev restart pipeline', async () => {
	server = await startDevServer();
	await server.waitForIdle({ timeoutMs: 30000 });
	const manifest = resolve(import.meta.dir, '../../../..', 'package.json');
	mutateFile(
		manifest,
		(source) =>
			`${JSON.stringify(
				{
					...JSON.parse(source),
					'x-dependency-watch-fixture': Date.now()
				},
				null,
				2
			)}\n`
	);
	const line = await server.waitForOutput(/\[abs:restart\].*package\.json/, {
		timeoutMs: 15000
	});
	expect(line).toContain(manifest);
}, 90000);
