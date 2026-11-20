import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/* Whether an app issues the CSRF cookie is decided once per process: the
 * page that has to carry a token is not the route that checks it, so the
 * `form` macro sets a module-level flag and the response hook reads it.
 *
 * That makes the interesting property — an app with no token routes
 * issues nothing, and so needs no secret — untestable in a shared test
 * process, where another file's app may already have turned the flag on.
 * Each case therefore runs in its own `bun` process, which is also the
 * boundary the property is really about. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');

const PROGRAM = (route: string) => `import { Elysia, t } from 'elysia';
import { formActions } from ${JSON.stringify(join(repoRoot, 'src/core/formActions.ts'))};

const html = (body) =>
	new Response('<!doctype html><html><body>' + body + '</body></html>', {
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});

const app = new Elysia()
	.use(formActions())
	.get('/page', () => html('<form data-absolute-action></form>'))
	${route};

const response = await app.handle(new Request('http://app.test/page'));
const cookie = response.headers
	.getSetCookie()
	.find((entry) => entry.startsWith('absolute_csrf='));
console.log(
	JSON.stringify({
		cacheControl: response.headers.get('cache-control'),
		cookie: Boolean(cookie)
	})
);
`;

const TOKEN_ROUTE = `.post(
		'/act',
		{
			form: {
				body: t.Object({ name: t.String() }),
				csrf: { token: true }
			}
		},
		() => ({ ok: true })
	)`;

const PLAIN_ROUTE = `.post(
		'/act',
		{ form: { body: t.Object({ name: t.String() }) } },
		() => ({ ok: true })
	)`;

const run = async (route: string) => {
	// Inside the repo, and dot-prefixed so the dev watcher ignores it: a
	// child under /tmp resolves its own copy of elysia from Bun's install
	// cache, and two Elysia instances cannot compose each other's plugins.
	const directory = await mkdtemp(join(repoRoot, '.csrf-scope-'));
	const entry = join(directory, 'app.ts');
	await writeFile(entry, PROGRAM(route));
	try {
		const proc = Bun.spawn(['bun', 'run', entry], {
			cwd: repoRoot,
			env: { ...process.env, TELEMETRY_OFF: '1' },
			stderr: 'pipe',
			stdout: 'pipe'
		});
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited
		]);
		const line = stdout.trim().split('\n').at(-1) ?? '';
		if (!line.startsWith('{'))
			throw new Error(`no result from the child:\n${stdout}\n${stderr}`);
		const parsed: unknown = JSON.parse(line);

		return parsed;
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
};

describe('who gets a CSRF cookie', () => {
	test('an app with a token route issues it with every HTML page', async () => {
		// Even this page, which embeds no token: its forms would have
		// nothing to read otherwise.
		expect(await run(TOKEN_ROUTE)).toEqual({
			cacheControl: null,
			cookie: true
		});
	}, 60_000);

	test('an app with no token route issues nothing', async () => {
		// Which is also why such an app never needs ABSOLUTE_SECRET: it
		// signs nothing.
		expect(await run(PLAIN_ROUTE)).toEqual({
			cacheControl: null,
			cookie: false
		});
	}, 60_000);
});
