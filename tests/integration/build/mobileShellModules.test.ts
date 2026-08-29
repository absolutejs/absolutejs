import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const temporaryDirectories: string[] = [];

afterAll(async () => {
	await Promise.all(
		temporaryDirectories.map((directory) =>
			rm(directory, { force: true, recursive: true })
		)
	);
});

test('published build ships linkable native shell modules', async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-mobile-shell-'));
	temporaryDirectories.push(root);
	const mobile = join(PROJECT_ROOT, 'dist', 'mobile');
	for (const name of [
		'shellBootstrap.js',
		'shellAuth.js',
		'shellExpoDevices.js',
		'shellSync.js'
	])
		expect(await Bun.file(join(mobile, name)).exists()).toBe(true);
	const entry = join(root, 'entry.ts');
	await Bun.write(
		entry,
		`import { startAbsoluteMobileShell } from ${JSON.stringify(join(mobile, 'shellBootstrap.js'))};
import { createAbsoluteMobileShellAuth } from ${JSON.stringify(join(mobile, 'shellAuth.js'))};
import { createAbsoluteExpoBridgeFetch, installAbsoluteExpoWebDeviceAdapter } from ${JSON.stringify(join(mobile, 'shellExpoDevices.js'))};
import { installAbsoluteMobileShellSync } from ${JSON.stringify(join(mobile, 'shellSync.js'))};
installAbsoluteExpoWebDeviceAdapter();
void createAbsoluteExpoBridgeFetch;
void startAbsoluteMobileShell({ createAuth: createAbsoluteMobileShellAuth, installSync: installAbsoluteMobileShellSync });
`
	);
	const result = await Bun.build({
		entrypoints: [entry],
		outdir: join(root, 'out'),
		target: 'browser'
	});
	expect(result.success).toBe(true);
	const source = await Bun.file(result.outputs[0]?.path ?? '').text();
	expect(source).toContain('absolute_sync_metadata');
	expect(source).toContain('networkStatusChange');
	expect(source).toContain('absolute:sync-status');
});
