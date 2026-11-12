import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/* error.html / not-found.html conventions for HTML and HTMX pages. The
 * static page handlers never rendered the error convention: a page whose
 * file couldn't be read (or that failed a static-page check) surfaced as an
 * unhandled error. They now behave like the framework handlers: status 500,
 * the HTMX directory's conventions first for HTMX pages, no stack in
 * production. Unmatched routes use not-found.html, the HTMX one for HTMX
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
	'htmlError' | 'htmxError' | 'notFound' | 'htmxNotFound' | 'home',
	Result
>;

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
console.error = () => undefined;

const read = async (response) => ({ body: await response.text(), status: response.status });
const probe = {
	htmlError: await read(await handleHTMLPageRequest(join(buildDir, 'html', 'pages', 'Missing.html'))),
	htmxError: await read(await handleHTMXPageRequest(manifest.Fragment))
};

if (${JSON.stringify(mode)} === 'production') {
	process.env.ABSOLUTE_BUILD_DIR = buildDir;
	const { absolutejs } = await prepare('absolute.config.ts');
	const app = new Elysia()
		.use(absolutejs)
		.get('/', () => handleHTMLPageRequest(manifest.Home));
	const request = (path, headers = {}) =>
		app.handle(new Request('http://localhost' + path, { headers }));
	probe.home = await read(await request('/'));
	probe.notFound = await read(await request('/no-such-page'));
	probe.htmxNotFound = await read(
		await request('/no-such-fragment', { 'HX-Request': 'true' })
	);
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
	const probe: Partial<Probe> = JSON.parse(line.slice('PROBE'.length));

	return probe;
};

const results: Partial<Record<Mode, Partial<Probe>>> = {};
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
		expect(body).toContain('Missing.html');
	});

	test('an HTMX page that throws renders the HTMX error.html with status 500', () => {
		const { body, status } = result('production', 'htmxError');

		expect(status).toBe(500);
		expect(body).toContain('HTMX_ERROR');
		expect(body).toContain('abs-stream-slot');
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
