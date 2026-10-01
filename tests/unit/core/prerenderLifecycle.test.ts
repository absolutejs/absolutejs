import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { prerenderWithServer } from '../../../src/core/prerender';
import { getAvailablePort } from '../../helpers/ports';

// Real subprocess: prove a production-configured render cannot opt into the
// guarded worker, then prove the same program can start it in normal runtime.
test('prerender overrides inherited live mode without poisoning normal runtime', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'absolute-prerender-worker-'));
	const marker = join(dir, 'worker-started');
	const entry = join(dir, 'server.ts');
	const helper = new URL(
		'../../../src/utils/isPrerendering.ts',
		import.meta.url
	).pathname;
	await writeFile(
		entry,
		`
import { isPrerendering } from ${JSON.stringify(helper)};
if (!isPrerendering()) await Bun.write(${JSON.stringify(marker)}, 'started');
if (process.env.NORMAL_PROBE === '1') process.exit(0);
Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }) });
`
	);
	try {
		await prerenderWithServer(
			entry,
			await getAvailablePort(),
			dir,
			{ routes: [] },
			{
				ABSOLUTE_PRERENDER: '0',
				FPP_ENVIRONMENT: 'production',
				NODE_ENV: 'production'
			}
		);
		expect(await Bun.file(marker).exists()).toBe(false);
		const normal = Bun.spawn(['bun', 'run', entry], {
			env: { ...process.env, ABSOLUTE_PRERENDER: '0', NORMAL_PROBE: '1' },
			stderr: 'pipe',
			stdout: 'pipe'
		});
		expect(await normal.exited).toBe(0);
		expect(await readFile(marker, 'utf8')).toBe('started');
	} finally {
		await rm(dir, { force: true, recursive: true });
	}
});
