import { afterEach, describe, expect, test } from 'bun:test';
import {
	chmod,
	copyFile,
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ensureDistBuild } from '../helpers/ensureDistBuild';
import { fetchPage, waitForServer } from '../helpers/http';
import { getAvailablePort } from '../helpers/ports';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const FIXTURE_DIR = resolve(PROJECT_ROOT, 'tests/fixtures/compile-stress');
const ANGULAR_FIXTURE_DIR = resolve(
	PROJECT_ROOT,
	'tests/fixtures/compile-angular'
);
const SVELTE_FIXTURE_DIR = resolve(
	PROJECT_ROOT,
	'tests/fixtures/compile-svelte'
);
const VUE_FIXTURE_DIR = resolve(PROJECT_ROOT, 'tests/fixtures/compile-vue');
const DEPENDENCY_STRESS_FIXTURE_DIR = resolve(
	PROJECT_ROOT,
	'tests/fixtures/compile-dependency-stress'
);
const DEPENDENCY_ASSETS_FIXTURE_DIR = resolve(
	PROJECT_ROOT,
	'tests/fixtures/compile-dependency-assets'
);
const FILES_FIXTURE_DIR = resolve(PROJECT_ROOT, 'tests/fixtures/compile-files');
const ROUTE_SCALE_FIXTURE_DIR = resolve(
	PROJECT_ROOT,
	'tests/fixtures/compile-route-scale'
);
const CLI_ENTRY = resolve(PROJECT_ROOT, 'dist/cli/index.js');
const ABSOLUTE_DIST_INDEX = resolve(PROJECT_ROOT, 'dist/index.js');
const ABSOLUTE_DIST_REACT = resolve(PROJECT_ROOT, 'dist/react/index.js');
const ABSOLUTE_DIST_ANGULAR = resolve(PROJECT_ROOT, 'dist/angular/server.js');
const ABSOLUTE_DIST_SVELTE = resolve(PROJECT_ROOT, 'dist/svelte/server.js');
const ABSOLUTE_DIST_VUE = resolve(PROJECT_ROOT, 'dist/vue/server.js');
const ELYSIA_ENTRY = resolve(PROJECT_ROOT, 'node_modules/elysia/dist/index.js');

const tempRoots = new Set<string>();
const serverProcesses = new Set<ReturnType<typeof Bun.spawn>>();
const dockerContainers = new Set<string>();
const dockerImages = new Set<string>();

const normalizeImportPath = (path: string) => path.replace(/\\/g, '/');

const makeTempDir = async (name: string) => {
	const dir = await mkdtemp(join(tmpdir(), `${name}-`));
	tempRoots.add(dir);

	return dir;
};

const patchFixtureImports = async (fixtureRoot: string) => {
	const replacements = {
		__ABSOLUTE_DIST_ANGULAR__: normalizeImportPath(ABSOLUTE_DIST_ANGULAR),
		__ABSOLUTE_DIST_INDEX__: normalizeImportPath(ABSOLUTE_DIST_INDEX),
		__ABSOLUTE_DIST_REACT__: normalizeImportPath(ABSOLUTE_DIST_REACT),
		__ABSOLUTE_DIST_SVELTE__: normalizeImportPath(ABSOLUTE_DIST_SVELTE),
		__ABSOLUTE_DIST_VUE__: normalizeImportPath(ABSOLUTE_DIST_VUE),
		__ELYSIA_ENTRY__: normalizeImportPath(ELYSIA_ENTRY)
	};
	const files: string[] = [];
	const collect = async (dir: string) => {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				await collect(path);
				continue;
			}
			if (/\.(svelte|ts|tsx|vue)$/.test(entry.name)) files.push(path);
		}
	};
	await collect(fixtureRoot);

	for (const file of files) {
		let text = await readFile(file, 'utf-8');
		for (const [token, value] of Object.entries(replacements)) {
			text = text.replaceAll(token, value);
		}
		await writeFile(file, text);
	}
};

const setupFixtureNodeModules = async (fixtureRoot: string) => {
	const localModulesRoot = join(fixtureRoot, '.absolute-test-node_modules');
	const localEntries = existsSync(localModulesRoot)
		? await readdir(localModulesRoot)
		: [];
	const hasLocalModules = localEntries.some((entry) =>
		existsSync(join(localModulesRoot, entry, 'package.json'))
	);

	if (!hasLocalModules) {
		await symlink(
			resolve(PROJECT_ROOT, 'node_modules'),
			join(fixtureRoot, 'node_modules'),
			'dir'
		);

		return;
	}

	const nodeModulesRoot = join(fixtureRoot, 'node_modules');
	await mkdir(nodeModulesRoot, { recursive: true });

	const rootEntries = await readdir(resolve(PROJECT_ROOT, 'node_modules'), {
		withFileTypes: true
	});
	await Promise.all(
		rootEntries.map((entry) =>
			symlink(
				resolve(PROJECT_ROOT, 'node_modules', entry.name),
				join(nodeModulesRoot, entry.name),
				entry.isDirectory() ? 'dir' : 'file'
			)
		)
	);

	await Promise.all(
		localEntries.map(async (entry) => {
			if (!existsSync(join(localModulesRoot, entry, 'package.json')))
				return;

			const target = join(nodeModulesRoot, entry);
			await rm(target, { force: true, recursive: true });
			await cp(join(localModulesRoot, entry), target, {
				recursive: true
			});
		})
	);
};

const runProcess = async (
	command: string[],
	options: {
		cwd: string;
		env?: Record<string, string | undefined>;
		timeoutMs?: number;
	}
) => {
	const proc = Bun.spawn(command, {
		cwd: options.cwd,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			TELEMETRY_OFF: '1',
			...options.env
		},
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const timeoutMs = options.timeoutMs ?? 120_000;
	const timeout = Bun.sleep(timeoutMs).then(() => {
		proc.kill();
		throw new Error(
			`Command timed out after ${timeoutMs}ms: ${command.join(' ')}`
		);
	});
	const exitCode = await Promise.race([proc.exited, timeout]);
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);
	if (exitCode !== 0) {
		throw new Error(
			`Command failed with code ${exitCode}: ${command.join(' ')}\n${stdout}\n${stderr}`
		);
	}

	return { stderr, stdout };
};

const canRunDocker = async () => {
	try {
		await runProcess(['docker', 'ps'], {
			cwd: PROJECT_ROOT,
			timeoutMs: 10_000
		});

		return true;
	} catch {
		return false;
	}
};

const prepareFixtureRoot = async (sourceFixtureDir: string) => {
	await ensureDistBuild();
	expect(existsSync(CLI_ENTRY)).toBe(true);

	const fixtureRoot = await makeTempDir('absolute-compile-fixture');
	await cp(sourceFixtureDir, fixtureRoot, { recursive: true });
	await setupFixtureNodeModules(fixtureRoot);
	await patchFixtureImports(fixtureRoot);

	return fixtureRoot;
};

const compileFixture = async (sourceFixtureDir: string) => {
	const fixtureRoot = await prepareFixtureRoot(sourceFixtureDir);

	await runProcess(
		[
			'bun',
			CLI_ENTRY,
			'compile',
			'server.ts',
			'--outdir',
			'build',
			'--outfile',
			'compiled-server'
		],
		{
			cwd: fixtureRoot,
			env: { COMPILE_RUNTIME_SECRET: 'compile-time-secret' },
			timeoutMs: 180_000
		}
	);

	return fixtureRoot;
};

const compileStressFixture = () => compileFixture(FIXTURE_DIR);
const compileAngularFixture = () => compileFixture(ANGULAR_FIXTURE_DIR);
const compileSvelteFixture = () => compileFixture(SVELTE_FIXTURE_DIR);
const compileVueFixture = () => compileFixture(VUE_FIXTURE_DIR);
const compileDependencyStressFixture = () =>
	compileFixture(DEPENDENCY_STRESS_FIXTURE_DIR);
const compileDependencyAssetsFixture = () =>
	compileFixture(DEPENDENCY_ASSETS_FIXTURE_DIR);
const compileFilesFixture = () => compileFixture(FILES_FIXTURE_DIR);
const compileRouteScaleFixture = () => compileFixture(ROUTE_SCALE_FIXTURE_DIR);

const startCompiledServer = async (
	cwd: string,
	port: number,
	env?: Record<string, string>,
	executableName = 'compiled-server'
) => {
	const executable = join(cwd, executableName);
	const proc = Bun.spawn([executable], {
		cwd,
		env: {
			...process.env,
			FORCE_COLOR: '0',
			PORT: String(port),
			TELEMETRY_OFF: '1',
			...env
		},
		stderr: 'pipe',
		stdout: 'pipe'
	});
	serverProcesses.add(proc);
	try {
		await waitForServer(`http://localhost:${port}/`, 80, 250);
	} catch (error) {
		proc.kill();
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text()
		]);
		throw new Error(
			`Compiled server did not start: ${
				error instanceof Error ? error.message : String(error)
			}\n${stdout}\n${stderr}`
		);
	}

	return proc;
};

const startProductionServer = async (
	cwd: string,
	port: number,
	env?: Record<string, string>
) => {
	const proc = Bun.spawn(
		[
			'bun',
			CLI_ENTRY,
			'start',
			'server.ts',
			'--outdir',
			'start-build',
			'--config',
			'absolute.config.ts'
		],
		{
			cwd,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				PORT: String(port),
				TELEMETRY_OFF: '1',
				...env
			},
			stderr: 'pipe',
			stdout: 'pipe'
		}
	);
	serverProcesses.add(proc);
	try {
		await waitForServer(`http://localhost:${port}/`, 160, 250);
	} catch (error) {
		proc.kill();
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text()
		]);
		throw new Error(
			`Production server did not start: ${
				error instanceof Error ? error.message : String(error)
			}\n${stdout}\n${stderr}`
		);
	}

	return proc;
};

const stopProcess = async (proc: ReturnType<typeof Bun.spawn>) => {
	serverProcesses.delete(proc);
	try {
		proc.kill();
	} catch {
		// already exited
	}
	await proc.exited.catch(() => {});
};

const cleanupDockerContainer = async (containerName: string) => {
	dockerContainers.delete(containerName);
	await runProcess(['docker', 'rm', '-f', containerName], {
		cwd: PROJECT_ROOT,
		timeoutMs: 30_000
	}).catch(() => {});
};

const cleanupDockerImage = async (imageName: string) => {
	dockerImages.delete(imageName);
	await runProcess(['docker', 'rmi', '-f', imageName], {
		cwd: PROJECT_ROOT,
		timeoutMs: 30_000
	}).catch(() => {});
};

const assertCompileStressServer = async (baseUrl: string) => {
	const rootPage = await fetchPage(baseUrl);
	expect(rootPage.status).toBe(200);
	expect(rootPage.html).toContain('GOOD_PAGE');
	expect(rootPage.html).toContain('/stress.css');

	const css = await fetch(`${baseUrl}/stress.css`);
	expect(css.status).toBe(200);
	expect(css.headers.get('content-type')).toContain('text/css');
	expect(await css.text()).toContain('rgb(12, 119, 92)');

	const api = await fetch(`${baseUrl}/api/ping?message=compiled`);
	expect(api.status).toBe(200);
	expect(await api.json()).toEqual({ message: 'compiled', ok: true });

	const envResponse = await fetch(`${baseUrl}/api/env`);
	expect(envResponse.status).toBe(200);
	expect(await envResponse.json()).toEqual({
		moduleLoadSecret: 'runtime-secret',
		ok: true,
		requestSecret: 'runtime-secret'
	});

	const firstState = await fetch(`${baseUrl}/api/state`);
	expect(firstState.status).toBe(200);
	expect(await firstState.json()).toEqual({ count: 1, ok: true });

	const secondState = await fetch(`${baseUrl}/api/state`);
	expect(secondState.status).toBe(200);
	expect(await secondState.json()).toEqual({ count: 2, ok: true });

	const jsonResponse = await fetch(`${baseUrl}/api/json?mode=compiled`, {
		body: JSON.stringify({ value: 'json-body' }),
		headers: { 'content-type': 'application/json' },
		method: 'POST'
	});
	expect(jsonResponse.status).toBe(200);
	expect(await jsonResponse.json()).toEqual({
		ok: true,
		query: 'compiled',
		value: 'json-body'
	});

	const malformedJsonResponse = await fetch(`${baseUrl}/api/json`, {
		body: '{"value":',
		headers: { 'content-type': 'application/json' },
		method: 'POST'
	});
	expect(malformedJsonResponse.status).toBe(500);

	const afterMalformedJson = await fetch(`${baseUrl}/api/ping`);
	expect(afterMalformedJson.status).toBe(200);
	expect(await afterMalformedJson.json()).toEqual({
		message: 'runtime',
		ok: true
	});

	const form = new FormData();
	form.set('value', 'form-value');
	form.set(
		'file',
		new File(['file-body'], 'compile.txt', { type: 'text/plain' })
	);
	const formResponse = await fetch(`${baseUrl}/api/form`, {
		body: form,
		method: 'POST'
	});
	expect(formResponse.status).toBe(200);
	expect(await formResponse.json()).toEqual({
		fileName: 'compile.txt',
		fileText: 'file-body',
		ok: true,
		value: 'form-value'
	});

	const cloneResponse = await fetch(`${baseUrl}/api/clone`, {
		body: 'clone-body',
		method: 'POST'
	});
	expect(cloneResponse.status).toBe(200);
	expect(await cloneResponse.json()).toEqual({
		clone: 'clone-body',
		ok: true,
		original: 'clone-body'
	});

	const headersResponse = await fetch(`${baseUrl}/api/headers-cookies`, {
		headers: {
			cookie: 'session=compiled; theme=dark',
			'x-compile-probe': 'header-ready'
		}
	});
	expect(headersResponse.status).toBe(200);
	expect(await headersResponse.json()).toEqual({
		cookie: 'session=compiled; theme=dark',
		ok: true,
		probe: 'header-ready'
	});

	const blobResponse = await fetch(`${baseUrl}/api/blob`);
	expect(blobResponse.status).toBe(200);
	expect(await blobResponse.json()).toEqual({
		ok: true,
		size: 10,
		text: 'BLOB_READY',
		type: 'text/plain;charset=utf-8'
	});

	const arrayBufferResponse = await fetch(`${baseUrl}/api/array-buffer`, {
		body: new Uint8Array([65, 66, 67]),
		method: 'POST'
	});
	expect(arrayBufferResponse.status).toBe(200);
	expect(await arrayBufferResponse.json()).toEqual({
		bytes: [65, 66, 67],
		ok: true,
		size: 3
	});

	const binaryResponse = await fetch(`${baseUrl}/api/binary`);
	expect(binaryResponse.status).toBe(200);
	expect(binaryResponse.headers.get('content-type')).toBe(
		'application/octet-stream'
	);
	expect(binaryResponse.headers.get('cache-control')).toBe('no-store');
	expect(binaryResponse.headers.get('x-binary-probe')).toBe('ready');
	expect(
		Array.from(new Uint8Array(await binaryResponse.arrayBuffer()))
	).toEqual([0, 1, 2, 253, 254, 255]);

	const setCookieResponse = await fetch(`${baseUrl}/api/set-cookie`);
	expect(setCookieResponse.status).toBe(200);
	expect(await setCookieResponse.json()).toEqual({ ok: true });
	expect(setCookieResponse.headers.get('set-cookie')).toContain(
		'compile-session=ready'
	);

	const putResponse = await fetch(`${baseUrl}/api/method/alpha`, {
		body: 'put-body',
		method: 'PUT'
	});
	expect(putResponse.status).toBe(200);
	expect(await putResponse.json()).toEqual({
		body: 'put-body',
		id: 'alpha',
		method: 'PUT',
		ok: true
	});

	const deleteResponse = await fetch(`${baseUrl}/api/method/beta`, {
		method: 'DELETE'
	});
	expect(deleteResponse.status).toBe(200);
	expect(await deleteResponse.json()).toEqual({
		id: 'beta',
		method: 'DELETE',
		ok: true
	});

	const repeatQueryResponse = await fetch(
		`${baseUrl}/api/query-repeat?tag=one&tag=two&tag=three`
	);
	expect(repeatQueryResponse.status).toBe(200);
	expect(await repeatQueryResponse.json()).toEqual({
		ok: true,
		values: ['one', 'two', 'three']
	});

	const largeBody = 'x'.repeat(256 * 1024);
	const largeEcho = await fetch(`${baseUrl}/api/echo`, {
		body: largeBody,
		method: 'POST'
	});
	expect(largeEcho.status).toBe(200);
	expect(await largeEcho.json()).toEqual({ body: largeBody, ok: true });

	const stream = await fetch(`${baseUrl}/stream`);
	expect(stream.status).toBe(200);
	expect(await stream.text()).toBe('STREAM_READY');

	const streamError = await fetch(`${baseUrl}/stream-error`);
	expect(streamError.status).toBe(200);
	await streamError.text();

	const afterStreamError = await fetch(`${baseUrl}/api/ping`);
	expect(afterStreamError.status).toBe(200);
	expect(await afterStreamError.json()).toEqual({
		message: 'runtime',
		ok: true
	});

	const missing = await fetchPage(`${baseUrl}/missing`);
	expect(missing.status).toBe(404);
	expect(missing.html).toContain('REACT_NOT_FOUND_CONVENTION');

	const boom = await fetchPage(`${baseUrl}/boom`);
	expect(boom.status).toBe(500);
	expect(boom.html).toContain('REACT_ERROR_CONVENTION');
	expect(boom.html).toContain('BOOM_PAGE_FAILURE');
};

const readParitySnapshot = async (baseUrl: string) => {
	const root = await fetchPage(baseUrl);
	const css = await fetch(`${baseUrl}/stress.css`);
	const ping = await fetch(`${baseUrl}/api/ping?message=compiled`);
	const json = await fetch(`${baseUrl}/api/json?mode=compiled`, {
		body: JSON.stringify({ value: 'json-body' }),
		headers: { 'content-type': 'application/json' },
		method: 'POST'
	});
	const headers = await fetch(`${baseUrl}/api/headers-cookies`, {
		headers: {
			cookie: 'session=compiled; theme=dark',
			'x-compile-probe': 'header-ready'
		}
	});
	const binary = await fetch(`${baseUrl}/api/binary`);
	const redirect = await fetch(`${baseUrl}/redirect-me`, {
		redirect: 'manual'
	});
	const missing = await fetchPage(`${baseUrl}/missing`);
	const boom = await fetchPage(`${baseUrl}/boom`);
	const normalizeContentType = (value: string | null) =>
		value?.replace(/;\s+/g, ';') ?? null;

	return {
		binaryBytes: Array.from(new Uint8Array(await binary.arrayBuffer())),
		binaryCacheControl: binary.headers.get('cache-control'),
		binaryStatus: binary.status,
		binaryType: binary.headers.get('content-type'),
		boomContainsError: boom.html.includes('REACT_ERROR_CONVENTION'),
		boomContainsFailure: boom.html.includes('BOOM_PAGE_FAILURE'),
		boomStatus: boom.status,
		cssBody: await css.text(),
		cssStatus: css.status,
		cssType: normalizeContentType(css.headers.get('content-type')),
		headersBody: await headers.json(),
		headersStatus: headers.status,
		jsonBody: await json.json(),
		jsonStatus: json.status,
		missingContainsNotFound: missing.html.includes(
			'REACT_NOT_FOUND_CONVENTION'
		),
		missingStatus: missing.status,
		pingBody: await ping.json(),
		pingStatus: ping.status,
		redirectLocation: redirect.headers.get('location'),
		redirectStatus: redirect.status,
		rootContainsCss: root.html.includes('/stress.css'),
		rootContainsGoodPage: root.html.includes('GOOD_PAGE'),
		rootStatus: root.status
	};
};

const assertCompileAngularServer = async (baseUrl: string) => {
	const rootPage = await fetchPage(baseUrl);
	expect(rootPage.status).toBe(200);
	expect(rootPage.html).toContain('ANGULAR_COMPILE_HOME');
	expect(rootPage.html).toContain('/angular.css');

	const css = await fetch(`${baseUrl}/angular.css`);
	expect(css.status).toBe(200);
	expect(css.headers.get('content-type')).toContain('text/css');
	expect(await css.text()).toContain('rgb(45, 91, 180)');

	const envResponse = await fetch(`${baseUrl}/api/env`);
	expect(envResponse.status).toBe(200);
	expect(await envResponse.json()).toEqual({
		ok: true,
		secret: 'runtime-secret'
	});

	const missing = await fetchPage(`${baseUrl}/missing-angular`);
	expect(missing.status).toBe(404);
	expect(missing.html).toContain('ANGULAR_NOT_FOUND_CONVENTION');
	expect(missing.html).toContain('/angular.css');

	const boom = await fetchPage(`${baseUrl}/boom`);
	expect(boom.status).toBe(500);
	expect(boom.html).toContain('ANGULAR_ERROR_CONVENTION');
	expect(boom.html).toContain('ANGULAR_BOOM_FAILURE');
};

const assertCompileSvelteServer = async (baseUrl: string) => {
	const rootPage = await fetchPage(baseUrl);
	expect(rootPage.status).toBe(200);
	expect(rootPage.html).toContain('SVELTE_COMPILE_HOME');
	expect(rootPage.html).toContain('/svelte.css');

	const css = await fetch(`${baseUrl}/svelte.css`);
	expect(css.status).toBe(200);
	expect(css.headers.get('content-type')).toContain('text/css');
	expect(await css.text()).toContain('rgb(24, 126, 148)');

	const envResponse = await fetch(`${baseUrl}/api/env`);
	expect(envResponse.status).toBe(200);
	expect(await envResponse.json()).toEqual({
		ok: true,
		secret: 'runtime-secret'
	});

	const missing = await fetchPage(`${baseUrl}/missing-svelte`);
	expect(missing.status).toBe(404);
	expect(missing.html).toContain('SVELTE_NOT_FOUND_CONVENTION');

	const boom = await fetchPage(`${baseUrl}/boom`);
	expect(boom.status).toBe(500);
	expect(boom.html).toContain('SVELTE_ERROR_CONVENTION');
	expect(boom.html).toContain('SVELTE_BOOM_FAILURE');
};

const assertCompileVueServer = async (baseUrl: string) => {
	const rootPage = await fetchPage(baseUrl);
	expect(rootPage.status).toBe(200);
	expect(rootPage.html).toContain('VUE_COMPILE_HOME');
	expect(rootPage.html).toContain('/vue.css');

	const css = await fetch(`${baseUrl}/vue.css`);
	expect(css.status).toBe(200);
	expect(css.headers.get('content-type')).toContain('text/css');
	expect(await css.text()).toContain('rgb(131, 74, 169)');

	const envResponse = await fetch(`${baseUrl}/api/env`);
	expect(envResponse.status).toBe(200);
	expect(await envResponse.json()).toEqual({
		ok: true,
		secret: 'runtime-secret'
	});

	const missing = await fetchPage(`${baseUrl}/missing-vue`);
	expect(missing.status).toBe(404);
	expect(missing.html).toContain('VUE_NOT_FOUND_CONVENTION');

	const boom = await fetchPage(`${baseUrl}/boom`);
	expect(boom.status).toBe(500);
	expect(boom.html).toContain('VUE_ERROR_CONVENTION');
	expect(boom.html).toContain('VUE_BOOM_FAILURE');
};

const assertCompileDependencyStressServer = async (baseUrl: string) => {
	const rootPage = await fetchPage(baseUrl);
	expect(rootPage.status).toBe(200);
	expect(rootPage.html).toContain('DEPENDENCY_STRESS_HOME');
	expect(rootPage.html).toContain('ANGULAR_FORMS_READY');
	expect(rootPage.html).toContain('/dependency.css');

	const css = await fetch(`${baseUrl}/dependency.css`);
	expect(css.status).toBe(200);
	expect(css.headers.get('content-type')).toContain('text/css');
	expect(await css.text()).toContain('rgb(97, 38, 142)');

	const deps = await fetch(`${baseUrl}/api/deps`);
	expect(deps.status).toBe(200);
	expect(await deps.json()).toEqual({
		cjs: 'CJS_36d0981b',
		dynamic: 'DYNAMIC_IMPORT_READY',
		env: 'runtime-secret',
		packageImport: 'PACKAGE_IMPORT_READY',
		storeCount: 7,
		zustandDynamic: true
	});

	const missing = await fetchPage(`${baseUrl}/missing-dependency`);
	expect(missing.status).toBe(404);
	expect(missing.html).toContain('DEPENDENCY_NOT_FOUND_CONVENTION');
	expect(missing.html).toContain('/dependency.css');

	const boom = await fetchPage(`${baseUrl}/boom`);
	expect(boom.status).toBe(500);
	expect(boom.html).toContain('DEPENDENCY_ERROR_CONVENTION');
	expect(boom.html).toContain('DEPENDENCY_BOOM_FAILURE');
};

const assertCompileDependencyAssetsServer = async (baseUrl: string) => {
	const rootPage = await fetchPage(baseUrl);
	expect(rootPage.status).toBe(200);
	expect(rootPage.html).toContain('DEPENDENCY_ASSETS_HOME');
	expect(rootPage.html).toContain('/dependency-assets.css');

	const css = await fetch(`${baseUrl}/dependency-assets.css`);
	expect(css.status).toBe(200);
	expect(css.headers.get('content-type')).toContain('text/css');
	expect(await css.text()).toContain('rgb(8, 81, 156)');

	const assets = await fetch(`${baseUrl}/api/dependency-assets`);
	expect(assets.status).toBe(200);
	expect(await assets.json()).toEqual({
		asset: 'PACKAGE_ASSET_FILE_READY',
		dynamic: 'PACKAGE_DYNAMIC_IMPORT_READY',
		style: 'PACKAGE_STYLE_SIDE_EFFECT_IMPORT_READY',
		subpath: 'PACKAGE_EXPORTS_SUBPATH_READY'
	});
};

const assertCompileFilesServer = async (baseUrl: string) => {
	const rootPage = await fetchPage(baseUrl);
	expect(rootPage.status).toBe(200);
	expect(rootPage.html).toContain('FILES_COMPILE_HOME');

	const files = await fetch(`${baseUrl}/api/files`);
	expect(files.status).toBe(200);
	expect(await files.json()).toEqual({
		blob: 'BUN_FILE_BLOB_READY',
		dirJoin: 'IMPORT_META_DIR_JOIN_READY',
		dynamicExists: false,
		dynamicModule: 'DYNAMIC_MODULE_ASSET_READY',
		json: {
			marker: 'JSON_IMPORT_READY',
			value: 42
		},
		nested: 'NESTED_READFILE_READY',
		template: '<section>READFILE_TEMPLATE_READY</section>'
	});

	const binaryFile = await fetch(`${baseUrl}/api/binary-file`);
	expect(binaryFile.status).toBe(200);
	expect(await binaryFile.json()).toEqual({
		ok: true,
		prefix: 'BINARY',
		size: 19
	});

	const publicFile = await fetch(`${baseUrl}/public.txt`);
	expect(publicFile.status).toBe(200);
	expect(await publicFile.text()).toBe('PUBLIC_FILE_READY\n');
};

const assertCompileRouteScaleServer = async (baseUrl: string) => {
	const root = await fetchPage(baseUrl);
	expect(root.status).toBe(200);
	expect(root.html).toContain('ROUTE_SCALE_HOME');

	const section = await fetchPage(`${baseUrl}/section`);
	expect(section.status).toBe(200);
	expect(section.html).toContain('ROUTE_SCALE_SECTION');

	const sectionSlash = await fetchPage(`${baseUrl}/section/`);
	expect(sectionSlash.status).toBe(200);
	expect(sectionSlash.html).toContain('ROUTE_SCALE_SECTION_SLASH');

	const deep = await fetchPage(`${baseUrl}/section/deep`);
	expect(deep.status).toBe(200);
	expect(deep.html).toContain('ROUTE_SCALE_DEEP');

	const queryAlpha = await fetchPage(`${baseUrl}/query?tab=alpha`);
	expect(queryAlpha.status).toBe(200);
	expect(queryAlpha.html).toContain('ROUTE_SCALE_QUERY_alpha');

	const queryBeta = await fetchPage(`${baseUrl}/query?tab=beta`);
	expect(queryBeta.status).toBe(200);
	expect(queryBeta.html).toContain('ROUTE_SCALE_QUERY_beta');

	const queryRuntime = await fetchPage(`${baseUrl}/query?tab=gamma`);
	expect(queryRuntime.status).toBe(200);
	expect(queryRuntime.html).toContain('ROUTE_SCALE_QUERY_gamma');

	const queryMissing = await fetchPage(`${baseUrl}/query`);
	expect(queryMissing.status).toBe(200);
	expect(queryMissing.html).toContain('ROUTE_SCALE_QUERY_missing');

	const firstPage = await fetchPage(`${baseUrl}/page-0`);
	expect(firstPage.status).toBe(200);
	expect(firstPage.html).toContain('ROUTE_SCALE_PAGE_0');

	const lastPage = await fetchPage(`${baseUrl}/page-47`);
	expect(lastPage.status).toBe(200);
	expect(lastPage.html).toContain('ROUTE_SCALE_PAGE_47');

	const missingPage = await fetch(`${baseUrl}/page-48`);
	expect(missingPage.status).toBe(404);
	expect(await missingPage.text()).toBe('missing scale page');

	const runtime = await fetch(`${baseUrl}/runtime/abc?mode=fallback`);
	expect(runtime.status).toBe(200);
	expect(await runtime.json()).toEqual({
		id: 'abc',
		mode: 'fallback',
		ok: true
	});

	const encodedRuntime = await fetch(
		`${baseUrl}/runtime/space%20value?mode=encoded`
	);
	expect(encodedRuntime.status).toBe(200);
	expect(await encodedRuntime.json()).toEqual({
		id: 'space value',
		mode: 'encoded',
		ok: true
	});

	const catchAll = await fetch(
		`${baseUrl}/catch-all/a/b/c?mode=fallback&tag=scale`
	);
	expect(catchAll.status).toBe(200);
	expect(await catchAll.json()).toEqual({
		ok: true,
		path: 'a/b/c',
		search: '?mode=fallback&tag=scale'
	});

	const skippedJson = await fetch(`${baseUrl}/api/static-json`);
	expect(skippedJson.status).toBe(200);
	expect(skippedJson.headers.get('content-type')).toContain(
		'application/json'
	);
	expect(await skippedJson.json()).toEqual({ cached: false, ok: true });

	const redirect = await fetch(`${baseUrl}/redirect-static`, {
		redirect: 'manual'
	});
	expect(redirect.status).toBe(302);
	expect(redirect.headers.get('location')).toBe('/section');

	const queryRedirect = await fetch(
		`${baseUrl}/redirect-query?target=from-runtime&mode=manual`,
		{ redirect: 'manual' }
	);
	expect(queryRedirect.status).toBe(307);
	expect(queryRedirect.headers.get('location')).toBe(
		'/runtime/from-runtime?mode=manual'
	);

	const staticQueryRedirect = await fetch(
		`${baseUrl}/redirect-query?target=from-static&mode=static`,
		{ redirect: 'manual' }
	);
	expect(staticQueryRedirect.status).toBe(307);
	expect(staticQueryRedirect.headers.get('location')).toBe(
		'/runtime/from-static?mode=static'
	);

	const headCheck = await fetch(`${baseUrl}/api/head-check`, {
		method: 'HEAD'
	});
	expect(headCheck.status).toBe(200);
	expect(headCheck.headers.get('x-route-scale-head')).toBe('ready');
	expect(await headCheck.text()).toBe('');

	const optionsCheck = await fetch(`${baseUrl}/api/options-check`, {
		method: 'OPTIONS'
	});
	expect(optionsCheck.status).toBe(204);
	expect(optionsCheck.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
	expect(optionsCheck.headers.get('x-route-scale-options')).toBe('ready');

	const assetLike = await fetch(`${baseUrl}/asset-like/known.txt`);
	expect(assetLike.status).toBe(200);
	expect(assetLike.headers.get('content-type')).toContain('text/plain');
	expect(await assetLike.text()).toBe('ROUTE_SCALE_ASSET_LIKE_READY');

	const missingAssetLike = await fetch(`${baseUrl}/asset-like/missing.txt`);
	expect(missingAssetLike.status).toBe(404);

	const css = await fetch(`${baseUrl}/scale.css`);
	expect(css.status).toBe(200);
	expect(await css.text()).toContain('rgb(31, 41, 59)');
};

const waitForEvaluate = async <T>(
	view: { evaluate: (script: string) => Promise<T> },
	script: string,
	predicate: (value: T) => boolean,
	timeoutMs = 5_000
) => {
	const start = performance.now();
	while (performance.now() - start < timeoutMs) {
		const value = await view.evaluate(script);
		if (predicate(value)) return value;
		await Bun.sleep(100);
	}
	const snapshot = await view.evaluate(
		"({ url: location.href, title: document.title, body: document.body?.innerHTML?.slice(0, 500) ?? '' })"
	);
	throw new Error(
		`Timed out waiting for browser expression: ${script}\n${JSON.stringify(snapshot)}`
	);
};

const runBrowserProbe = async (baseUrl: string) => {
	const browserBaseUrl = baseUrl.replace('localhost', '127.0.0.1');
	const WebView = (
		Bun as unknown as {
			WebView?: new (options: Record<string, unknown>) => {
				addEventListener?: (
					type: string,
					listener: (event: { data?: unknown }) => void
				) => void;
				cdp?: (
					method: string,
					params?: Record<string, unknown>
				) => Promise<unknown>;
				click: (
					selector: string,
					options?: Record<string, unknown>
				) => Promise<void>;
				close: () => void;
				evaluate: <T = unknown>(script: string) => Promise<T>;
				navigate: (url: string) => Promise<void>;
			};
		}
	).WebView;
	if (!WebView) return;

	const consoleErrors: unknown[] = [];
	const failedRequests: unknown[] = [];
	const isImplicitBrowserRequest = (url?: string) =>
		url ? new URL(url).pathname === '/favicon.ico' : false;
	let view: InstanceType<NonNullable<typeof WebView>> | undefined;
	try {
		view = new WebView({
			backend: 'chrome',
			console: (type: string, ...args: unknown[]) => {
				if (type === 'error') consoleErrors.push(args);
			},
			height: 720,
			width: 1280
		});
		await view.navigate('about:blank');
		if (view.cdp && view.addEventListener) {
			await view.cdp('Network.enable');
			view.addEventListener('Network.loadingFailed', (event) => {
				failedRequests.push(event.data);
			});
			view.addEventListener('Network.responseReceived', (event) => {
				const data = event.data as
					| { response?: { status?: number; url?: string } }
					| undefined;
				const status = data?.response?.status;
				if (
					status &&
					status >= 400 &&
					!isImplicitBrowserRequest(data?.response?.url)
				)
					failedRequests.push(data);
			});
		}
	} catch (error) {
		console.warn(
			`Skipping Bun.WebView compile probe: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
		view?.close();

		return;
	}

	try {
		await view.navigate(`${browserBaseUrl}/browser`);
		expect(
			await waitForEvaluate(
				view,
				"document.querySelector('h1')?.textContent ?? ''",
				(value) => value === 'BROWSER_READY'
			)
		).toBe('BROWSER_READY');
		expect(
			await view.evaluate<string>(
				"getComputedStyle(document.querySelector('.status')).color"
			)
		).toBe('rgb(12, 119, 92)');
		expect(
			await waitForEvaluate(
				view,
				"document.querySelector('#dynamic-feature')?.textContent ?? ''",
				(value) => value === 'DYNAMIC_IMPORT_CLIENT_READY'
			)
		).toBe('DYNAMIC_IMPORT_CLIENT_READY');
		expect(
			await waitForEvaluate(
				view,
				"document.querySelector('#worker-feature')?.textContent ?? ''",
				(value) => value === 'WORKER_CLIENT_READY_compile'
			)
		).toBe('WORKER_CLIENT_READY_compile');

		await view.click('#increment');
		await waitForEvaluate(
			view,
			"document.querySelector('#increment')?.textContent ?? ''",
			(value) => String(value).includes('1')
		);

		await view.navigate(`${browserBaseUrl}/`);
		expect(
			await waitForEvaluate(
				view,
				"document.querySelector('h1')?.textContent ?? ''",
				(value) => value === 'GOOD_PAGE'
			)
		).toBe('GOOD_PAGE');
		expect(
			await waitForEvaluate(
				view,
				"document.querySelector('#client-ready')?.textContent ?? ''",
				(value) => value === 'CLIENT_READY'
			)
		).toBe('CLIENT_READY');
		await view.click('#increment');
		await waitForEvaluate(
			view,
			"document.querySelector('#increment')?.textContent ?? ''",
			(value) => String(value).includes('1')
		);

		expect(consoleErrors).toEqual([]);
		expect(failedRequests).toEqual([]);
	} finally {
		view.close();
	}
};

const runFrameworkHydrationProbe = async (
	baseUrl: string,
	options: {
		buttonSelector: string;
		buttonText: string;
		heading: string;
		readySelector: string;
		readyText: string;
		styleSelector: string;
		styleValue: string;
	}
) => {
	const browserBaseUrl = baseUrl.replace('localhost', '127.0.0.1');
	const WebView = (
		Bun as unknown as {
			WebView?: new (options: Record<string, unknown>) => {
				addEventListener?: (
					type: string,
					listener: (event: { data?: unknown }) => void
				) => void;
				cdp?: (
					method: string,
					params?: Record<string, unknown>
				) => Promise<unknown>;
				click: (
					selector: string,
					options?: Record<string, unknown>
				) => Promise<void>;
				close: () => void;
				evaluate: <T = unknown>(script: string) => Promise<T>;
				navigate: (url: string) => Promise<void>;
			};
		}
	).WebView;
	if (!WebView) return;

	const consoleErrors: unknown[] = [];
	const failedRequests: unknown[] = [];
	const isImplicitBrowserRequest = (url?: string) =>
		url ? new URL(url).pathname === '/favicon.ico' : false;
	let view: InstanceType<NonNullable<typeof WebView>> | undefined;
	try {
		view = new WebView({
			backend: 'chrome',
			console: (type: string, ...args: unknown[]) => {
				if (type === 'error') consoleErrors.push(args);
			},
			height: 720,
			width: 1280
		});
		await view.navigate('about:blank');
		if (view.cdp && view.addEventListener) {
			await view.cdp('Network.enable');
			view.addEventListener('Network.loadingFailed', (event) => {
				failedRequests.push(event.data);
			});
			view.addEventListener('Network.responseReceived', (event) => {
				const data = event.data as
					| { response?: { status?: number; url?: string } }
					| undefined;
				const status = data?.response?.status;
				if (
					status &&
					status >= 400 &&
					!isImplicitBrowserRequest(data?.response?.url)
				)
					failedRequests.push(data);
			});
		}
	} catch (error) {
		console.warn(
			`Skipping Bun.WebView framework compile probe: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
		view?.close();

		return;
	}

	try {
		await view.navigate(`${browserBaseUrl}/`);
		expect(
			await waitForEvaluate(
				view,
				"document.querySelector('h1')?.textContent ?? ''",
				(value) => value === options.heading
			)
		).toBe(options.heading);
		expect(
			await view.evaluate<string>(
				`getComputedStyle(document.querySelector('${options.styleSelector}')).color`
			)
		).toBe(options.styleValue);
		expect(
			await waitForEvaluate(
				view,
				`document.querySelector('${options.readySelector}')?.textContent ?? ''`,
				(value) => value === options.readyText
			)
		).toBe(options.readyText);

		await view.click(options.buttonSelector);
		await waitForEvaluate(
			view,
			`document.querySelector('${options.buttonSelector}')?.textContent ?? ''`,
			(value) => String(value).includes(options.buttonText)
		);

		expect(consoleErrors).toEqual([]);
		expect(failedRequests).toEqual([]);
	} finally {
		view.close();
	}
};

afterEach(async () => {
	for (const proc of [...serverProcesses]) {
		await stopProcess(proc);
	}
	for (const containerName of [...dockerContainers]) {
		await cleanupDockerContainer(containerName);
	}
	for (const imageName of [...dockerImages]) {
		await cleanupDockerImage(imageName);
	}
	for (const root of [...tempRoots]) {
		await rm(root, { force: true, recursive: true }).catch(() => {});
		tempRoots.delete(root);
	}
});

describe('compile executable integration', () => {
	test('serves prerendered pages, runtime fallback, conventions, and browser assets from a copied executable', async () => {
		const fixtureRoot = await compileStressFixture();

		const runRoot = await makeTempDir('absolute-compile-run');
		await copyFile(
			join(fixtureRoot, 'compiled-server'),
			join(runRoot, 'compiled-server')
		);
		await chmod(join(runRoot, 'compiled-server'), 0o755);

		const port = await getAvailablePort();
		const proc = await startCompiledServer(runRoot, port, {
			COMPILE_RUNTIME_SECRET: 'runtime-secret'
		});
		const baseUrl = `http://localhost:${port}`;

		await assertCompileStressServer(baseUrl);

		const post = await fetch(`${baseUrl}/api/echo`, {
			body: 'hello compile',
			method: 'POST'
		});
		expect(post.status).toBe(200);
		expect(await post.json()).toEqual({ body: 'hello compile', ok: true });

		const header = await fetch(`${baseUrl}/header`, {
			headers: { 'x-compile-probe': 'present' }
		});
		expect(await header.json()).toEqual({ probe: 'present' });

		const redirect = await fetch(`${baseUrl}/redirect-me`, {
			redirect: 'manual'
		});
		expect(redirect.status).toBe(302);
		expect(redirect.headers.get('location')).toBe('/linked');

		await runBrowserProbe(baseUrl);

		await stopProcess(proc);
	}, 240_000);

	test('runs after the source fixture is removed', async () => {
		const fixtureRoot = await compileStressFixture();

		const runRoot = await makeTempDir(
			'absolute-compile-source-removed-run'
		);
		await copyFile(
			join(fixtureRoot, 'compiled-server'),
			join(runRoot, 'compiled-server')
		);
		await chmod(join(runRoot, 'compiled-server'), 0o755);

		await rm(fixtureRoot, { force: true, recursive: true });
		tempRoots.delete(fixtureRoot);

		const port = await getAvailablePort();
		const proc = await startCompiledServer(runRoot, port, {
			COMPILE_RUNTIME_SECRET: 'runtime-secret'
		});
		const baseUrl = `http://localhost:${port}`;

		await assertCompileStressServer(baseUrl);

		await stopProcess(proc);
	}, 240_000);

	test('handles compile CLI path edge cases', async () => {
		const fixtureRoot = await prepareFixtureRoot(FIXTURE_DIR);
		await mkdir(join(fixtureRoot, 'commands'), { recursive: true });
		await cp(
			join(fixtureRoot, 'react'),
			join(fixtureRoot, 'commands/react'),
			{ recursive: true }
		);
		await cp(
			join(fixtureRoot, 'public'),
			join(fixtureRoot, 'commands/public'),
			{ recursive: true }
		);
		await copyFile(
			join(fixtureRoot, 'server.ts'),
			join(fixtureRoot, 'commands/server.ts')
		);
		await writeFile(
			join(fixtureRoot, 'commands/absolute.config.ts'),
			`import { defineConfig } from '${normalizeImportPath(ABSOLUTE_DIST_INDEX)}';

export default defineConfig({
	buildDirectory: './build',
	publicDirectory: './public',
	reactDirectory: './react'
});
`
		);

		await runProcess(
			[
				'bun',
				CLI_ENTRY,
				'compile',
				'server.ts',
				'--config',
				'absolute.config.ts',
				'--outdir',
				'nested/output/build',
				'--outfile',
				'nested/bin/server-one'
			],
			{
				cwd: join(fixtureRoot, 'commands'),
				env: { COMPILE_RUNTIME_SECRET: 'compile-time-secret' },
				timeoutMs: 180_000
			}
		);
		expect(
			existsSync(join(fixtureRoot, 'commands/nested/bin/server-one'))
		).toBe(true);
		expect(
			existsSync(
				join(fixtureRoot, 'commands/nested/output/build/manifest.json')
			)
		).toBe(true);

		await runProcess(
			[
				'bun',
				CLI_ENTRY,
				'compile',
				'server.ts',
				'--config',
				'absolute.config.ts',
				'--outdir',
				'nested/output/build',
				'--outfile',
				'nested/bin/server-two'
			],
			{
				cwd: join(fixtureRoot, 'commands'),
				env: { COMPILE_RUNTIME_SECRET: 'compile-time-secret' },
				timeoutMs: 180_000
			}
		);
		expect(
			existsSync(join(fixtureRoot, 'commands/nested/bin/server-two'))
		).toBe(true);

		const runRoot = await makeTempDir('absolute-compile-cli-edge-run');
		await copyFile(
			join(fixtureRoot, 'commands/nested/bin/server-two'),
			join(runRoot, 'compiled-server')
		);
		await chmod(join(runRoot, 'compiled-server'), 0o755);
		const unrelatedCwd = await makeTempDir('absolute-compile-other-cwd');
		await symlink(
			join(runRoot, 'compiled-server'),
			join(unrelatedCwd, 'compiled-server'),
			'file'
		);

		const port = await getAvailablePort();
		const proc = await startCompiledServer(unrelatedCwd, port, {
			COMPILE_RUNTIME_SECRET: 'runtime-secret'
		});
		const baseUrl = `http://localhost:${port}`;

		await assertCompileStressServer(baseUrl);

		await stopProcess(proc);
	}, 360_000);

	test('serializes concurrent compile commands targeting the same outdir', async () => {
		const fixtureRoot = await prepareFixtureRoot(FIXTURE_DIR);
		const sharedOutdir = join(fixtureRoot, 'shared-build');
		const firstOutfile = join(fixtureRoot, 'bin/first-server');
		const secondOutfile = join(fixtureRoot, 'bin/second-server');
		await mkdir(join(fixtureRoot, 'bin'), { recursive: true });

		const compileCommand = (outfile: string) =>
			runProcess(
				[
					'bun',
					CLI_ENTRY,
					'compile',
					'server.ts',
					'--outdir',
					sharedOutdir,
					'--outfile',
					outfile
				],
				{
					cwd: fixtureRoot,
					env: { COMPILE_RUNTIME_SECRET: 'compile-time-secret' },
					timeoutMs: 240_000
				}
			);

		await Promise.all([
			compileCommand(firstOutfile),
			compileCommand(secondOutfile)
		]);

		expect(existsSync(firstOutfile)).toBe(true);
		expect(existsSync(secondOutfile)).toBe(true);
		expect(existsSync(join(sharedOutdir, 'manifest.json'))).toBe(true);
		expect(existsSync(join(fixtureRoot, '.shared-build.lock'))).toBe(false);
	}, 480_000);

	test('matches production start behavior for core runtime responses', async () => {
		const fixtureRoot = await compileStressFixture();

		const startPort = await getAvailablePort();
		const compiledPort = await getAvailablePort();
		const startProc = await startProductionServer(fixtureRoot, startPort, {
			COMPILE_RUNTIME_SECRET: 'runtime-secret'
		});
		const compiledProc = await startCompiledServer(
			fixtureRoot,
			compiledPort,
			{ COMPILE_RUNTIME_SECRET: 'runtime-secret' }
		);

		const startSnapshot = await readParitySnapshot(
			`http://localhost:${startPort}`
		);
		const compiledSnapshot = await readParitySnapshot(
			`http://localhost:${compiledPort}`
		);

		expect(compiledSnapshot).toEqual(startSnapshot);

		await stopProcess(compiledProc);
		await stopProcess(startProc);
	}, 360_000);

	test('runs as a Docker image containing only the compiled executable', async () => {
		if (!(await canRunDocker())) {
			console.warn('Skipping Docker compile probe: Docker unavailable');

			return;
		}

		const fixtureRoot = await compileStressFixture();
		const dockerRoot = await makeTempDir('absolute-compile-docker');
		const imageName = `absolute-compile-test:${randomUUID()}`;
		const containerName = `absolute-compile-test-${randomUUID()}`;
		dockerImages.add(imageName);
		dockerContainers.add(containerName);

		await copyFile(
			join(fixtureRoot, 'compiled-server'),
			join(dockerRoot, 'compiled-server')
		);
		await writeFile(
			join(dockerRoot, 'Dockerfile'),
			`FROM debian:bookworm-slim
WORKDIR /app
COPY compiled-server /app/compiled-server
RUN chmod +x /app/compiled-server
ENV PORT=3000
EXPOSE 3000
CMD ["/app/compiled-server"]
`
		);

		await runProcess(['docker', 'build', '-t', imageName, '.'], {
			cwd: dockerRoot,
			timeoutMs: 180_000
		});

		const port = await getAvailablePort();
		const run = await runProcess(
			[
				'docker',
				'run',
				'-d',
				'--name',
				containerName,
				'-p',
				`${port}:3000`,
				'-e',
				'COMPILE_RUNTIME_SECRET=runtime-secret',
				imageName
			],
			{ cwd: dockerRoot, timeoutMs: 60_000 }
		);
		expect(run.stdout.trim()).not.toBe('');

		const baseUrl = `http://localhost:${port}`;
		try {
			await waitForServer(baseUrl, 120, 250);
		} catch (error) {
			const logs = await runProcess(['docker', 'logs', containerName], {
				cwd: dockerRoot,
				timeoutMs: 30_000
			}).catch((logsError) => ({
				stderr: String(logsError),
				stdout: ''
			}));
			throw new Error(
				`Docker compiled server did not start: ${
					error instanceof Error ? error.message : String(error)
				}\n${logs.stdout}\n${logs.stderr}`
			);
		}

		await assertCompileStressServer(baseUrl);

		await cleanupDockerContainer(containerName);
		await cleanupDockerImage(imageName);
	}, 360_000);

	test('serves Angular pages and conventions from a copied executable', async () => {
		const fixtureRoot = await compileAngularFixture();

		const runRoot = await makeTempDir('absolute-compile-angular-run');
		await copyFile(
			join(fixtureRoot, 'compiled-server'),
			join(runRoot, 'compiled-server')
		);
		await chmod(join(runRoot, 'compiled-server'), 0o755);

		const port = await getAvailablePort();
		const proc = await startCompiledServer(runRoot, port, {
			COMPILE_ANGULAR_SECRET: 'runtime-secret'
		});
		const baseUrl = `http://localhost:${port}`;

		await assertCompileAngularServer(baseUrl);

		await stopProcess(proc);
	}, 300_000);

	test('serves Svelte pages and conventions from a copied executable', async () => {
		const fixtureRoot = await compileSvelteFixture();

		const runRoot = await makeTempDir('absolute-compile-svelte-run');
		await copyFile(
			join(fixtureRoot, 'compiled-server'),
			join(runRoot, 'compiled-server')
		);
		await chmod(join(runRoot, 'compiled-server'), 0o755);

		const port = await getAvailablePort();
		const proc = await startCompiledServer(runRoot, port, {
			COMPILE_SVELTE_SECRET: 'runtime-secret'
		});
		const baseUrl = `http://localhost:${port}`;

		await assertCompileSvelteServer(baseUrl);
		await runFrameworkHydrationProbe(baseUrl, {
			buttonSelector: '#svelte-increment',
			buttonText: 'Svelte Count 1',
			heading: 'SVELTE_COMPILE_HOME',
			readySelector: '#svelte-client-ready',
			readyText: 'SVELTE_CLIENT_READY',
			styleSelector: '.svelte-compile-home',
			styleValue: 'rgb(24, 126, 148)'
		});

		await stopProcess(proc);
	}, 300_000);

	test('serves Vue pages and conventions from a copied executable', async () => {
		const fixtureRoot = await compileVueFixture();

		const runRoot = await makeTempDir('absolute-compile-vue-run');
		await copyFile(
			join(fixtureRoot, 'compiled-server'),
			join(runRoot, 'compiled-server')
		);
		await chmod(join(runRoot, 'compiled-server'), 0o755);

		const port = await getAvailablePort();
		const proc = await startCompiledServer(runRoot, port, {
			COMPILE_VUE_SECRET: 'runtime-secret'
		});
		const baseUrl = `http://localhost:${port}`;

		await assertCompileVueServer(baseUrl);
		await runFrameworkHydrationProbe(baseUrl, {
			buttonSelector: '#vue-increment',
			buttonText: 'Vue Count 1',
			heading: 'VUE_COMPILE_HOME',
			readySelector: '#vue-client-ready',
			readyText: 'VUE_CLIENT_READY',
			styleSelector: '.vue-compile-home',
			styleValue: 'rgb(131, 74, 169)'
		});

		await stopProcess(proc);
	}, 300_000);

	test('serves Angular dependency pressure from a copied executable', async () => {
		const fixtureRoot = await compileDependencyStressFixture();

		const runRoot = await makeTempDir('absolute-compile-dependency-run');
		await copyFile(
			join(fixtureRoot, 'compiled-server'),
			join(runRoot, 'compiled-server')
		);
		await chmod(join(runRoot, 'compiled-server'), 0o755);

		const port = await getAvailablePort();
		const proc = await startCompiledServer(runRoot, port, {
			COMPILE_DEP_STRESS_SECRET: 'runtime-secret'
		});
		const baseUrl = `http://localhost:${port}`;

		await assertCompileDependencyStressServer(baseUrl);

		await stopProcess(proc);
	}, 300_000);

	test('serves dependency package assets and export subpaths from a copied executable', async () => {
		const fixtureRoot = await compileDependencyAssetsFixture();

		const runRoot = await makeTempDir(
			'absolute-compile-dependency-assets-run'
		);
		await copyFile(
			join(fixtureRoot, 'compiled-server'),
			join(runRoot, 'compiled-server')
		);
		await chmod(join(runRoot, 'compiled-server'), 0o755);

		const port = await getAvailablePort();
		const proc = await startCompiledServer(runRoot, port);
		const baseUrl = `http://localhost:${port}`;

		await assertCompileDependencyAssetsServer(baseUrl);

		await stopProcess(proc);
	}, 240_000);

	test('serves runtime file assets from a copied executable', async () => {
		const fixtureRoot = await compileFilesFixture();

		const runRoot = await makeTempDir('absolute-compile-files-run');
		await copyFile(
			join(fixtureRoot, 'compiled-server'),
			join(runRoot, 'compiled-server')
		);
		await chmod(join(runRoot, 'compiled-server'), 0o755);

		const port = await getAvailablePort();
		const proc = await startCompiledServer(runRoot, port);
		const baseUrl = `http://localhost:${port}`;

		await assertCompileFilesServer(baseUrl);

		await stopProcess(proc);
	}, 240_000);

	test('serves route scale and prerender fallback separation from a copied executable', async () => {
		const fixtureRoot = await compileRouteScaleFixture();

		const runRoot = await makeTempDir('absolute-compile-route-scale-run');
		await copyFile(
			join(fixtureRoot, 'compiled-server'),
			join(runRoot, 'compiled-server')
		);
		await chmod(join(runRoot, 'compiled-server'), 0o755);

		const port = await getAvailablePort();
		const proc = await startCompiledServer(runRoot, port);
		const baseUrl = `http://localhost:${port}`;

		await assertCompileRouteScaleServer(baseUrl);

		await stopProcess(proc);
	}, 240_000);
});
