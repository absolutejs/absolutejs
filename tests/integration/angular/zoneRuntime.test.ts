import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const PROBE = resolve(
	import.meta.dir,
	'../../fixtures/angular-zone/zoneProbe.ts'
);
const PROBE_PORT = 4648;

type ProbeResult = {
	asyncRoute: string;
	downleveledNote: string | null;
	nativeAsyncNote: string | null;
	promiseName: string;
	syncRoute: string;
};

const isProbeResult = (value: unknown): value is ProbeResult =>
	typeof value === 'object' &&
	value !== null &&
	'asyncRoute' in value &&
	'promiseName' in value;

const runProbe = async () => {
	const child = Bun.spawn(['bun', PROBE, String(PROBE_PORT)], {
		cwd: resolve(import.meta.dir, '../../..'),
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [stdout, stderr] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text()
	]);
	await child.exited;
	const line = stdout
		.split('\n')
		.find((candidate) => candidate.startsWith('{"asyncRoute"'));
	if (!line) throw new Error(`zone probe printed no result:\n${stderr}`);
	const parsed: unknown = JSON.parse(line);
	if (!isProbeResult(parsed)) throw new Error(`bad probe output: ${line}`);

	return parsed;
};

describe('Angular zone.js runtime on Bun', () => {
	test('async Elysia routes still answer and zone SSR waits for downleveled async', async () => {
		const result = await runProbe();

		expect(result.promiseName).toBe('ZoneAwarePromise');
		// Without the Bun.serve wrapper this is Bun's "Welcome to Bun!" page.
		expect(result.asyncRoute).toBe('{"ok":true}');
		expect(result.syncRoute).toBe('sync');
		// Native async/await resumes outside the zone: SSR misses the update.
		expect(result.nativeAsyncNote).toBe('pending');
		expect(result.downleveledNote).toBe('resolved after await');
	}, 60_000);
});
