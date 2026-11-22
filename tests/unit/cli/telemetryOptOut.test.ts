import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* `DO_NOT_TRACK` is the cross-tool convention: set it once and every CLI
 * on the machine should stop. This one ignored it — measured with
 * telemetry enabled and `DO_NOT_TRACK=1` exported, the POST to
 * absolutejs.com still went out. `TELEMETRY_OFF` was honoured, but only
 * for the exact string `'1'`.
 *
 * The sender reads `homedir()` and the ambient environment at call time,
 * so each case runs in its own process with its own HOME: importing the
 * module once and mutating `process.env` would leak the first case's
 * decision into the rest. `fetch` is replaced in that child, which is the
 * only way to see that nothing was sent rather than that nothing
 * arrived. */

const repoRoot = join(import.meta.dir, '..', '..', '..');
const homes: string[] = [];

const PROBE = `
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const home = process.env.HOME ?? '';
mkdirSync(join(home, '.absolutejs'), { recursive: true });
writeFileSync(
	join(home, '.absolutejs', 'telemetry.json'),
	JSON.stringify({
		anonymousId: 'probe',
		createdAt: '2026-01-01T00:00:00.000Z',
		enabled: true
	})
);

const sent = [];
globalThis.fetch = (url) => {
	sent.push(String(url));

	return Promise.resolve(new Response('{}'));
};

const { sendTelemetryEvent } = await import(
	${JSON.stringify(join(repoRoot, 'src', 'cli', 'telemetryEvent.ts'))}
);
const { isTelemetryEnabled, telemetryOptOut } = await import(
	${JSON.stringify(join(repoRoot, 'src', 'cli', 'scripts', 'telemetry.ts'))}
);

sendTelemetryEvent('probe:event', { probe: true });
await Bun.sleep(25);
console.log(
	JSON.stringify({
		enabled: isTelemetryEnabled(),
		optOut: telemetryOptOut(),
		requests: sent
	})
);
`;

type Probe = {
	enabled: boolean;
	optOut: string | null;
	requests: string[];
};

const probe = async (env: Record<string, string | undefined>) => {
	const home = mkdtempSync(join(tmpdir(), 'absolute-dnt-'));
	homes.push(home);
	mkdirSync(home, { recursive: true });
	const script = join(home, 'probe.ts');
	writeFileSync(script, PROBE);

	/* Both variables are cleared first: this machine exports
	 * `DO_NOT_TRACK=1`, which would make every case look like an opt-out
	 * and the test pass for the wrong reason. */
	const child = Bun.spawn(['bun', script], {
		env: {
			...process.env,
			DO_NOT_TRACK: undefined,
			HOME: home,
			TELEMETRY_OFF: undefined,
			...env
		},
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [out, err] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text()
	]);
	const line = out.trim().split('\n').at(-1);
	if (line === undefined || !line.startsWith('{'))
		throw new Error(`probe produced no result:\n${out}\n${err}`);
	const parsed: Probe = JSON.parse(line);

	return parsed;
};

afterEach(() => {
	for (const home of homes) rmSync(home, { force: true, recursive: true });
	homes.length = 0;
});

describe('telemetry opt-out', () => {
	/* The control. Without it, a suite where everything is suppressed
	 * passes even if the sender is broken and never sends at all. */
	test('sends when telemetry is enabled and nothing opts out', async () => {
		const result = await probe({});

		expect(result.optOut).toBeNull();
		expect(result.enabled).toBe(true);
		expect(result.requests).toEqual([
			'https://absolutejs.com/api/telemetry'
		]);
	});

	test.each([['1'], ['true'], ['TRUE'], ['yes']])(
		'DO_NOT_TRACK=%s sends nothing',
		async (value) => {
			const result = await probe({ DO_NOT_TRACK: value });

			expect(result.optOut).toBe('DO_NOT_TRACK');
			expect(result.enabled).toBe(false);
			expect(result.requests).toEqual([]);
		}
	);

	/* An exported-but-empty variable is how a shell leaves a cleared
	 * value, and `0` / `false` are how someone says "no, do track". */
	test.each([[''], ['0'], ['false']])(
		'DO_NOT_TRACK=%p is not an opt-out',
		async (value) => {
			const result = await probe({ DO_NOT_TRACK: value });

			expect(result.optOut).toBeNull();
			expect(result.requests.length).toBe(1);
		}
	);

	/* The pre-existing check was `=== '1'`, so this value sent anyway. */
	test('TELEMETRY_OFF=true sends nothing', async () => {
		const result = await probe({ TELEMETRY_OFF: 'true' });

		expect(result.optOut).toBe('TELEMETRY_OFF');
		expect(result.requests).toEqual([]);
	});

	test('TELEMETRY_OFF=1 still sends nothing', async () => {
		const result = await probe({ TELEMETRY_OFF: '1' });

		expect(result.requests).toEqual([]);
	});

	/* `DO_NOT_TRACK` is the convention, so it is the one a status message
	 * should name when both are set. */
	test('names DO_NOT_TRACK when both variables are set', async () => {
		const result = await probe({ DO_NOT_TRACK: '1', TELEMETRY_OFF: '1' });

		expect(result.optOut).toBe('DO_NOT_TRACK');
	});
});
