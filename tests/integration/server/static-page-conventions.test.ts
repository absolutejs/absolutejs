import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/* error.html / not-found.html conventions for HTML and HTMX pages. The
 * static page handlers never rendered the error convention: a page whose
 * file couldn't be read (or that failed a static-page check) surfaced as an
 * unhandled error. They now behave like the framework handlers: status 500,
 * the HTMX directory's conventions first for HTMX pages, no stack and a
 * generic message in production. Unmatched routes use not-found.html, the HTMX one for HTMX
 * requests. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const root = join(
	repoRoot,
	'.test-builds',
	`static-page-conventions-${process.pid}`
);

type Mode = 'development' | 'production';
type Result = { body: string; status: number };
type Probe = Record<
	| 'htmlError'
	| 'htmxError'
	| 'notFound'
	| 'htmxNotFound'
	| 'home'
	| 'routeThrows'
	| 'routeThrowsHtmx'
	| 'routeThrowsApi'
	| 'routeStatus'
	| 'routeThrowsAppHandler',
	Result
>;
type ProbeOutput = Partial<Probe> & {
	logs?: Record<string, number>;
	noConventionJson?: Result;
	noConventionPage?: Result;
	routeThrowsAny?: Result;
};

const FILES: Record<string, string> = {
	'absolute.config.ts': `export default {
	buildDirectory: 'build',
	htmlDirectory: 'html',
	htmxDirectory: 'htmx'
};
`,
	'html/pages/error.html':
		'<!doctype html><html><body><h1>HTML_ERROR {{ message }}</h1><pre id="stack">[{{ stack }}]</pre></body></html>\n',
	'html/pages/Home.html':
		'<!doctype html><html><head><title>home</title></head><body>HOME_PAGE</body></html>\n',
	'html/pages/not-found.html':
		'<!doctype html><html><body>HTML_NOT_FOUND</body></html>\n',
	'htmx/pages/error.html':
		'<!doctype html><html><body><h1>HTMX_ERROR {{ message }}</h1><pre id="stack">[{{ stack }}]</pre></body></html>\n',
	'htmx/pages/Fragment.html':
		'<!doctype html><html><body><abs-stream-slot id="x"></abs-stream-slot></body></html>\n',
	'htmx/pages/not-found.html':
		'<!doctype html><html><body>HTMX_NOT_FOUND</body></html>\n'
};

const probeScript = (mode: Mode) => `
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { build } from ${JSON.stringify(join(repoRoot, 'src', 'core', 'build.ts'))};
import {
	handleHTMLPageRequest,
	handleHTMXPageRequest
} from ${JSON.stringify(join(repoRoot, 'src', 'core', 'pageHandlers.ts'))};
import { prepare } from ${JSON.stringify(join(repoRoot, 'src', 'core', 'prepare.ts'))};
import { setConventions } from ${JSON.stringify(join(repoRoot, 'src', 'utils', 'resolveConvention.ts'))};

const buildDir = join(process.cwd(), 'build-${mode}');
const result = await build({
	buildDirectory: 'build-${mode}',
	htmlDirectory: 'html',
	htmxDirectory: 'htmx',
	mode: '${mode}',
	options: { throwOnError: true }
});
const manifest = result?.manifest ?? {};
setConventions(JSON.parse(readFileSync(join(buildDir, 'conventions.json'), 'utf8')));
/* Count the server-side '[SSR] <METHOD> <path> threw:' lines each request
 * writes (with the stack in the logged error), per probe. */
const errorLines = [];
console.error = (...args) => {
	errorLines.push(args.map((arg) => (arg instanceof Error ? 'ERROR:' + arg.stack : String(arg))).join(' '));
};
const countThrows = (from, path) =>
	errorLines
		.slice(from)
		.filter((line) => line.startsWith('[SSR] GET ' + path + ' threw:') && line.includes('ERROR:Error: route secret'))
		.length;
const countAll = (from) => errorLines.length - from;

const read = async (response) => ({ body: await response.text(), status: response.status });
const probe = {
	logs: {},
	htmlError: await read(await handleHTMLPageRequest(join(buildDir, 'html', 'pages', 'Missing.html'))),
	htmxError: await read(await handleHTMXPageRequest(manifest.Fragment))
};

if (${JSON.stringify(mode)} === 'production') {
	process.env.ABSOLUTE_BUILD_DIR = buildDir;
	const { absolutejs } = await prepare('absolute.config.ts');
	const app = new Elysia()
		.use(absolutejs)
		.get('/', () => handleHTMLPageRequest(manifest.Home))
		.get('/throws', () => {
			throw new Error('route secret at /srv/app/server.ts');
		})
		.get('/teapot', ({ status }) => {
			throw status(418, 'TEAPOT');
		});
	const request = (path, headers = {}) =>
		app.handle(new Request('http://localhost' + path, { headers }));
	/* Runs one request and records how many '[SSR] ... threw:' lines it
	 * logged (and, under logKey + 'All', how many console.error lines). */
	const logged = async (logKey, path, headers) => {
		const from = errorLines.length;
		const response = await request(path, headers);
		const body = await read(response);
		probe.logs[logKey] = countThrows(from, path);
		probe.logs[logKey + 'All'] = countAll(from);

		return body;
	};
	probe.home = await read(await request('/'));
	probe.notFound = await logged('notFound', '/no-such-page', {});
	probe.htmxNotFound = await read(
		await request('/no-such-fragment', { 'HX-Request': 'true' })
	);
	const page = { accept: 'text/html,application/xhtml+xml' };
	probe.routeThrows = await logged('page', '/throws', page);
	probe.routeThrowsHtmx = await logged('htmx', '/throws', { 'HX-Request': 'true' });
	probe.routeThrowsApi = await logged('json', '/throws', { accept: 'application/json' });
	probe.routeThrowsAny = await logged('any', '/throws', { accept: '*/*' });
	await logged('noAccept', '/throws', {});
	probe.routeStatus = await logged('status', '/teapot', page);
	await logged('apiNotFound', '/no-such-api', { accept: 'application/json' });

	/* No error.html convention at all (a React-only project): every request
	 * still logs once and gets Elysia's JSON 500. */
	const savedConventions = JSON.parse(readFileSync(join(buildDir, 'conventions.json'), 'utf8'));
	setConventions({});
	probe.noConventionPage = await logged('noConventionPage', '/throws', page);
	probe.noConventionJson = await logged('noConventionJson', '/throws', { accept: 'application/json' });
	setConventions(savedConventions);

	/* An app with its own onError, registered after .use(absolutejs), keeps
	 * handling these errors itself. The app is found when it starts, so this
	 * one listens. Started last: the runtime plugin remembers the started app. */
	const withHandler = new Elysia()
		.use(absolutejs)
		.onError(() => new Response('APP_ERROR_HANDLER', { status: 500 }))
		.get('/throws', () => {
			throw new Error('route secret at /srv/app/server.ts');
		})
		.listen(0);
	const appHandlerFrom = errorLines.length;
	probe.routeThrowsAppHandler = await read(
		await fetch('http://localhost:' + withHandler.server.port + '/throws', {
			headers: page
		})
	);
	probe.logs.appHandler = countThrows(appHandlerFrom, '/throws');
	await withHandler.stop();
}

process.stdout.write('PROBE' + JSON.stringify(probe) + '\\n');
process.exit(0);
`;

const run = async (mode: Mode) => {
	const scriptPath = join(root, `probe-${mode}.ts`);
	await writeFile(scriptPath, probeScript(mode));
	const proc = Bun.spawn(['bun', scriptPath], {
		cwd: root,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			NODE_ENV: mode,
			TELEMETRY_OFF: '1'
		},
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);
	const line = stdout.split('\n').find((entry) => entry.startsWith('PROBE'));
	if (exitCode !== 0 || !line) {
		throw new Error(`probe (${mode}) failed:\n${stdout}\n${stderr}`);
	}
	const probe: ProbeOutput = JSON.parse(line.slice('PROBE'.length));

	return probe;
};

const results: Partial<Record<Mode, ProbeOutput>> = {};
const result = (mode: Mode, key: keyof Probe) => {
	const value = results[mode]?.[key];
	if (!value) throw new Error(`no ${mode} ${key} result`);

	return value;
};

beforeAll(async () => {
	await Promise.all(
		Object.entries(FILES).map(async ([name, source]) => {
			await mkdir(join(root, name, '..'), { recursive: true });
			await writeFile(join(root, name), source);
		})
	);
	results.production = await run('production');
	results.development = await run('development');
}, 300_000);

afterAll(async () => {
	await rm(root, { force: true, recursive: true });
});

describe('HTML and HTMX error conventions', () => {
	test('an HTML page that throws renders error.html with status 500', () => {
		const { body, status } = result('production', 'htmlError');

		expect(status).toBe(500);
		expect(body).toContain('HTML_ERROR');
	});

	test('an HTMX page that throws renders the HTMX error.html with status 500', () => {
		const { body, status } = result('production', 'htmxError');

		expect(status).toBe(500);
		expect(body).toContain('HTMX_ERROR');
	});

	test('production error pages show a generic message, never a server path', () => {
		for (const key of ['htmlError', 'htmxError'] as const) {
			const { body } = result('production', key);

			expect(body).toContain('Something went wrong');
			expect(body).not.toContain(root);
			expect(body).not.toContain('Missing.html');
			expect(body).not.toContain('ENOENT');
			expect(body).not.toContain('abs-stream-slot');
		}
	});

	test('development error pages keep the real message', () => {
		expect(result('development', 'htmlError').body).toContain(
			'Missing.html'
		);
		expect(result('development', 'htmxError').body).toContain(
			'abs-stream-slot'
		);
	});

	test('production error pages carry no stack; development ones do', () => {
		expect(result('production', 'htmlError').body).toContain(
			'<pre id="stack">[]</pre>'
		);
		expect(result('production', 'htmxError').body).toContain(
			'<pre id="stack">[]</pre>'
		);
		expect(result('development', 'htmlError').body).toMatch(
			/<pre id="stack">\[\w*Error: /
		);
	});
});

describe('HTML and HTMX not-found conventions', () => {
	test('an unknown route renders not-found.html with status 404', () => {
		expect(result('production', 'home').body).toContain('HOME_PAGE');
		const { body, status } = result('production', 'notFound');

		expect(status).toBe(404);
		expect(body).toContain('HTML_NOT_FOUND');
	});

	test('an HTMX request for an unknown route gets the HTMX not-found.html', () => {
		const { body, status } = result('production', 'htmxNotFound');

		expect(status).toBe(404);
		expect(body).toContain('HTMX_NOT_FOUND');
	});
});

/* A route handler that throws before reaching a page handler used to get
 * Elysia's JSON 500. Page navigations and HTMX requests now get error.html. */
describe('Errors thrown by route handlers', () => {
	test('a page navigation renders the HTML error.html with status 500', () => {
		const { body, status } = result('production', 'routeThrows');

		expect(status).toBe(500);
		expect(body).toContain(
			'HTML_ERROR Something went wrong while rendering this page.'
		);
		expect(body).toContain('<pre id="stack">[]</pre>');
		expect(body).not.toContain('route secret');
		expect(body).not.toContain('/srv/app');
	});

	test('an HTMX request renders the HTMX error.html', () => {
		const { body, status } = result('production', 'routeThrowsHtmx');

		expect(status).toBe(500);
		expect(body).toContain(
			'HTMX_ERROR Something went wrong while rendering this page.'
		);
		expect(body).not.toContain('route secret');
	});

	test("an app's own onError, registered after .use(absolutejs), still handles them", () => {
		const { body, status } = result('production', 'routeThrowsAppHandler');

		expect(status).toBe(500);
		expect(body).toBe('APP_ERROR_HANDLER');
	});

	test('non-page requests and thrown status responses are left alone', () => {
		const api = result('production', 'routeThrowsApi');
		expect(api.status).toBe(500);
		expect(api.body).not.toContain('HTML_ERROR');

		const teapot = result('production', 'routeStatus');
		expect(teapot.status).toBe(418);
		expect(teapot.body).toContain('TEAPOT');
	});
});

/* With no app onError, AbsoluteJS's fallback is the only thing that sees a
 * thrown route, so it logs every one once (method, path, stack) whatever the
 * Accept header. Fetch and curl clients used to get a JSON 500 and nothing in
 * the log. */
describe('Logging errors thrown by route handlers', () => {
	const logs = () => {
		const value = results.production?.logs;
		if (!value) throw new Error('no production logs');

		return value;
	};

	test('each request that throws is logged exactly once, whatever it accepts', () => {
		const counts = logs();
		for (const key of ['page', 'htmx', 'json', 'any', 'noAccept']) {
			expect({ count: counts[key], key }).toEqual({ count: 1, key });
			// The page and HTMX ones render error.html; nothing else logs.
			expect({ all: counts[`${key}All`], key }).toEqual({ all: 1, key });
		}
	});

	test('the response to a non-page request stays generic', () => {
		const json = result('production', 'routeThrowsApi');
		expect(json.status).toBe(500);
		expect(json.body).not.toContain('/srv/app');
		const any = results.production?.routeThrowsAny;
		expect(any?.status).toBe(500);
		expect(any?.body).not.toContain('/srv/app');
	});

	test('a project with no error.html convention still logs once', () => {
		const counts = logs();
		expect(counts.noConventionPage).toBe(1);
		expect(counts.noConventionJson).toBe(1);
		expect(results.production?.noConventionPage?.status).toBe(500);
		expect(results.production?.noConventionJson?.status).toBe(500);
	});

	test('not-found routes and thrown status responses log nothing', () => {
		const counts = logs();
		expect(counts.notFoundAll).toBe(0);
		expect(counts.apiNotFoundAll).toBe(0);
		expect(counts.statusAll).toBe(0);
	});

	test("an app's own onError takes over, so the fallback logs nothing", () => {
		expect(logs().appHandler).toBe(0);
	});
});
