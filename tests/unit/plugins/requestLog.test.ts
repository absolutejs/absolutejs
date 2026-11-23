import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';

/* The access log plugin against a real Elysia app.
 *
 * In a separate process, and deliberately: the plugin's output IS
 * `console.log`, and a test that patches `console.log` in the shared unit
 * runner leaks into every file that sorts after it. An earlier version of
 * exactly that (the Angular dev-log filter) passed alone and failed in
 * CI's shared run. Here stdout is the data — the `json` format writes one
 * object per line — so the program needs no capture at all and the
 * assertions read what a log pipeline would read. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const roots: string[] = [];

const src = (path: string) => JSON.stringify(join(repoRoot, path));

const PROGRAM = `import { Elysia } from 'elysia';
import { absoluteRequestContext } from ${src('src/core/requestContext.ts')};
import { requestLog } from ${src('src/plugins/requestLog.ts')};

const routes = (app) =>
	app
		.get('/ok', () => new Response('hello'))
		.get('/boom', () => {
			throw new Error('deliberate');
		})
		.get('/__absolute/live', () => new Response('{}'));

const app = routes(
	new Elysia().use(absoluteRequestContext).use(requestLog({ requests: 'json' }))
);

const echoed = [];
for (const request of [
	new Request('http://app.test/ok'),
	new Request('http://app.test/missing'),
	new Request('http://app.test/boom'),
	new Request('http://app.test/ok', { headers: { 'x-request-id': 'inbound-123' } }),
	new Request('http://app.test/ok', { headers: { 'x-request-id': 'two words' } })
]) {
	const response = await app.handle(request);
	echoed.push(response.headers.get('x-request-id'));
}

/* A readiness probe: answered, and deliberately not logged. */
const probe = await app.handle(new Request('http://app.test/__absolute/live'));

/* The same probe against an app that asked for internal traffic. */
const verbose = routes(
	new Elysia()
		.use(absoluteRequestContext)
		.use(requestLog({ requests: 'json', logInternalRequests: true }))
);
await verbose.handle(new Request('http://app.test/__absolute/live'));

console.log('RESULT ' + JSON.stringify({ echoed, probeId: probe.headers.get('x-request-id'), probeStatus: probe.status }));
`;

type LogLine = {
	at: string;
	durationMs: number;
	level: string;
	method: string;
	msg: string;
	path: string;
	requestId: string;
	status: number;
};

type Run = {
	echoed: (string | null)[];
	lines: LogLine[];
	probeId: string | null;
	probeStatus: number;
};

const runProgram = async () => {
	const root = await mkdtemp(join(repoRoot, '.request-log-'));
	roots.push(root);
	const file = join(root, 'program.ts');
	await writeFile(file, PROGRAM);
	const result = Bun.spawnSync(['bun', 'run', file], { cwd: repoRoot });
	const stdout = result.stdout.toString();
	if (result.exitCode !== 0)
		throw new Error(
			`the program failed (${result.exitCode}):\n${result.stderr.toString()}\n${stdout}`
		);
	const printed = stdout.trim().split('\n').filter(Boolean);
	const resultLine = printed.find((line) => line.startsWith('RESULT '));
	if (resultLine === undefined)
		throw new Error(`no RESULT line in:\n${stdout}`);
	const reported = JSON.parse(resultLine.slice('RESULT '.length));
	const run: Run = {
		echoed: reported.echoed,
		lines: printed
			.filter((line) => line.startsWith('{'))
			.map((line) => JSON.parse(line)),
		probeId: reported.probeId,
		probeStatus: reported.probeStatus
	};

	return run;
};

const run = await runProgram();

/* The program's two apps write to one stream, so the app's own requests are
 * the lines that are not framework-internal. */
const appLines = run.lines.filter(
	(line) => !line.path.startsWith('/__absolute/')
);

afterAll(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('the access log', () => {
	test('writes exactly one line per request', () => {
		/* Five app requests. The sixth request in the program is a health
		 * probe, which is not logged — see below. */
		expect(appLines).toHaveLength(5);
		expect(run.lines.every((line) => line.msg === 'request')).toBe(true);
	});

	test('records the method, the path and a duration', () => {
		const [first] = run.lines;

		expect(first?.method).toBe('GET');
		expect(first?.path).toBe('/ok');
		expect(first?.status).toBe(200);
		expect(first?.level).toBe('info');
		expect(typeof first?.durationMs).toBe('number');
		expect(Number.isFinite(first?.durationMs)).toBe(true);
		expect(Date.parse(first?.at ?? '')).not.toBeNaN();
	});

	/* The requests nobody writes a handler for are the ones worth logging:
	 * a 404 never reaches one, and a 500 reaches one that threw. Both have
	 * to carry a status and a level rather than defaulting to 200/info. */
	test('a request that reaches no handler is logged with its status', () => {
		const missing = run.lines.find((line) => line.path === '/missing');

		expect(missing?.status).toBe(404);
		expect(missing?.level).toBe('warn');
	});

	test('a handler that threw is logged as an error', () => {
		const boom = run.lines.find((line) => line.path === '/boom');

		expect(boom?.status).toBe(500);
		expect(boom?.level).toBe('error');
	});
});

describe('the request id', () => {
	test('every request gets one', () => {
		expect(run.lines.every((line) => line.requestId.length > 0)).toBe(true);
	});

	test('two requests do not share one', () => {
		expect(new Set(run.lines.map((line) => line.requestId)).size).toBe(
			run.lines.length
		);
	});

	/* The id on the response is the id in the log. Without this the header
	 * a user quotes and the line an operator greps are different strings,
	 * which is worse than having neither. */
	test('the echoed header is the logged id', () => {
		expect(run.echoed).toEqual(appLines.map((line) => line.requestId));
	});

	/* Including for the 404 and the 500, which is where it matters: the
	 * header is set on the way in, not by a handler. */
	test('an error response carries the header too', () => {
		const boomIndex = appLines.findIndex((line) => line.path === '/boom');

		expect(run.echoed[boomIndex]).toBe(appLines[boomIndex]?.requestId);
	});

	test('a proxy’s id is adopted', () => {
		expect(appLines[3]?.requestId).toBe('inbound-123');
		expect(run.echoed[3]).toBe('inbound-123');
	});

	/* `req=two words` in a text line is ambiguous, and a space is a header
	 * value a real request can carry. Replaced, not escaped, and not
	 * dropped. */
	test('an unusable inbound id is replaced', () => {
		expect(appLines[4]?.requestId).not.toBe('two words');
		expect(appLines[4]?.requestId.length).toBeGreaterThan(0);
	});
});

describe('framework-internal traffic', () => {
	/* A readiness probe every two seconds is 43,200 lines a day that say
	 * nothing about anyone using the site, and they would arrive the moment
	 * someone turned the access log on. The dev request inspector skips the
	 * same prefix for the same reason. */
	test('a health probe is answered but not logged', () => {
		expect(run.probeStatus).toBe(200);
		expect(
			run.lines.filter((line) => line.path === '/__absolute/live')
		).toHaveLength(1);
	});

	/* The id is still assigned and echoed, so a probe that misbehaves can
	 * still be correlated with whatever else it touched. */
	test('the probe still carries a request id', () => {
		expect(run.probeId).not.toBeNull();
		expect((run.probeId ?? '').length).toBeGreaterThan(0);
	});

	/* And the one line that DOES exist for that path comes from the second
	 * app, the one that asked for internal traffic. */
	test('logInternalRequests logs it', () => {
		const internal = run.lines.filter(
			(line) => line.path === '/__absolute/live'
		);

		expect(internal).toHaveLength(1);
		expect(internal[0]?.status).toBe(200);
	});
});
