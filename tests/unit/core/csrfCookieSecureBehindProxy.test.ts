import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/* The CSRF cookie's `Secure` flag was decided from the request's OWN
 * protocol:
 *
 *     const secure = new URL(request.url).protocol === 'https:';
 *
 * A proxy that terminates TLS forwards plain HTTP, so on most real
 * deployments that is `http:` and the flag was omitted. The browser then
 * sends the CSRF token cookie over plain HTTP to the same host, where
 * anyone on the network can read it — and a readable token defeats the
 * token half of the check it exists for. `secureHeaders()` already read
 * `x-forwarded-proto`; the cookie code did not, so the two disagreed in
 * exactly this shape.
 *
 * Run in a separate process for the same reason as `csrfCookieScope`:
 * whether an app issues the cookie at all is a module-level flag, so a
 * shared test process cannot tell "this app issues none" from "another
 * file's app already turned it on". */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const roots: string[] = [];

const PROGRAM = `import { Elysia, t } from 'elysia';
import { formActions } from ${JSON.stringify(join(repoRoot, 'src/core/formActions.ts'))};

const html = (body) =>
	new Response('<!doctype html><html><body>' + body + '</body></html>', {
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});

const app = new Elysia()
	.use(formActions())
	.get('/page', () => html('<form data-absolute-action></form>'))
	/* A route asking for the token is what arms the cookie: whether an app
	 * issues one is a module-level flag the \`form\` macro sets, and the
	 * GET response hook reads it. Without this route no cookie is issued
	 * at all and there is nothing to inspect. */
	.post(
		'/act',
		{
			form: {
				body: t.Object({ name: t.String() }),
				csrf: { token: true }
			}
		},
		() => ({ ok: true })
	);

/* The shapes a real deployment takes. The proxied ones are the point:
 * the connection this process sees is plain HTTP. */
const shapes = {
	directHttp: new Request('http://app.test/page'),
	directHttps: new Request('https://app.test/page'),
	proxied: new Request('http://10.0.0.7:3000/page', {
		headers: { 'x-forwarded-proto': 'https', host: 'app.test' }
	}),
	twoHops: new Request('http://10.0.0.7:3000/page', {
		headers: { 'x-forwarded-proto': 'https, http', host: 'app.test' }
	}),
	forwardedHeader: new Request('http://10.0.0.7:3000/page', {
		headers: { forwarded: 'for=203.0.113.4;proto=https', host: 'app.test' }
	})
};

const result = {};
for (const [name, request] of Object.entries(shapes)) {
	const response = await app.handle(request);
	const cookie = response.headers
		.getSetCookie()
		.find((entry) => entry.startsWith('absolute_csrf='));
	result[name] = {
		issued: Boolean(cookie),
		secure: cookie === undefined ? null : /;\\s*Secure/i.test(cookie)
	};
}
console.log(JSON.stringify(result));
`;

type Shape = { issued: boolean; secure: boolean | null };

/* Inside the repository, and run with `cwd` there, so `elysia` resolves
 * to the version this project depends on. A temp dir under the OS temp
 * root resolves Bun's global cache instead, and two Elysia instances
 * cannot compose each other's plugins. */
const runOnce = async (root: string) => {
	const script = join(root, 'program.ts');
	await writeFile(script, PROGRAM);
	/* Removed in `finally`: an earlier version cleaned up only on the
	 * success path, so every failed run left a `.csrf-secure-*` directory
	 * in the repository. */
	const child = Bun.spawn(['bun', 'run', script], {
		cwd: repoRoot,
		env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [out, err] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text()
	]);
	const line = out.trim().split('\n').at(-1);
	if (line === undefined || !line.startsWith('{'))
		throw new Error(`program produced no result:\n${out}\n${err}`);
	const parsed: Record<string, Shape> = JSON.parse(line);

	return parsed;
};

const run = async () => {
	const root = await mkdtemp(join(repoRoot, '.csrf-secure-'));
	roots.push(root);
	try {
		return await runOnce(root);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
};

describe('the CSRF cookie behind a proxy', () => {
	test('is Secure wherever the browser used TLS, however it reached us', async () => {
		const shapes = await run();

		/* Every one of these had a browser on TLS, so every one must carry
		 * `Secure`. The three proxied shapes are the ones that did not. */
		expect({
			directHttps: shapes.directHttps?.secure,
			forwardedHeader: shapes.forwardedHeader?.secure,
			proxied: shapes.proxied?.secure,
			twoHops: shapes.twoHops?.secure
		}).toEqual({
			directHttps: true,
			forwardedHeader: true,
			proxied: true,
			twoHops: true
		});
	}, 120_000);

	/* And not over-corrected: a genuinely plain-HTTP deployment must not
	 * be handed a cookie the browser will refuse to send back. */
	test('is not Secure on a plain-HTTP deployment', async () => {
		const shapes = await run();

		expect(shapes.directHttp?.secure).toBe(false);
	}, 120_000);

	test('the cookie is issued in every shape', async () => {
		const shapes = await run();

		expect(Object.values(shapes).every((shape) => shape.issued)).toBe(true);
	}, 120_000);
});
