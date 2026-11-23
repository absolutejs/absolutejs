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

const app = new Elysia()
	.use(absoluteRequestContext)
	.use(requestLog({ requests: 'json' }))
	.get('/ok', () => new Response('hello'))
	.get('/boom', () => {
		throw new Error('deliberate');
	});

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
console.log('RESULT ' + JSON.stringify(echoed));
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

type Run = { echoed: (string | null)[]; lines: LogLine[] };

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
	const run: Run = {
		echoed: JSON.parse(resultLine.slice('RESULT '.length)),
		lines: printed
			.filter((line) => line.startsWith('{'))
			.map((line) => JSON.parse(line))
	};

	return run;
};

const run = await runProgram();

afterAll(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('the access log', () => {
	test('writes exactly one line per request', () => {
		expect(run.lines).toHaveLength(5);
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
		expect(new Set(run.lines.map((line) => line.requestId)).size).toBe(5);
	});

	/* The id on the response is the id in the log. Without this the header
	 * a user quotes and the line an operator greps are different strings,
	 * which is worse than having neither. */
	test('the echoed header is the logged id', () => {
		expect(run.echoed).toEqual(run.lines.map((line) => line.requestId));
	});

	/* Including for the 404 and the 500, which is where it matters: the
	 * header is set on the way in, not by a handler. */
	test('an error response carries the header too', () => {
		const boomIndex = run.lines.findIndex((line) => line.path === '/boom');

		expect(run.echoed[boomIndex]).toBe(run.lines[boomIndex]?.requestId);
	});

	test('a proxy’s id is adopted', () => {
		expect(run.lines[3]?.requestId).toBe('inbound-123');
		expect(run.echoed[3]).toBe('inbound-123');
	});

	/* `req=two words` in a text line is ambiguous, and a space is a header
	 * value a real request can carry. Replaced, not escaped, and not
	 * dropped. */
	test('an unusable inbound id is replaced', () => {
		expect(run.lines[4]?.requestId).not.toBe('two words');
		expect(run.lines[4]?.requestId.length).toBeGreaterThan(0);
	});
});
