import { afterEach, describe, expect, test } from 'bun:test';
import {
	chmod,
	copyFile,
	mkdir,
	mkdtemp,
	rm,
	writeFile
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getAvailablePort } from '../helpers/ports';
import { waitForServer } from '../helpers/http';

const shouldRunPublishedBeta = process.env.ABSOLUTE_TEST_PUBLISHED_BETA === '1';
const publishedBetaTest = shouldRunPublishedBeta ? test : test.skip;

const tempRoots = new Set<string>();
const serverProcesses = new Set<ReturnType<typeof Bun.spawn>>();

const makeTempDir = async (name: string) => {
	const dir = await mkdtemp(join(tmpdir(), `${name}-`));
	tempRoots.add(dir);

	return dir;
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

const stopProcess = async (proc: ReturnType<typeof Bun.spawn>) => {
	serverProcesses.delete(proc);
	try {
		proc.kill();
	} catch {
		// already exited
	}
	await proc.exited.catch(() => {});
};

const startCompiledServer = async (
	cwd: string,
	port: number,
	env?: Record<string, string>
) => {
	const executable = join(cwd, 'compiled-server');
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
			`Published beta compiled server did not start: ${
				error instanceof Error ? error.message : String(error)
			}\n${stdout}\n${stderr}`
		);
	}

	return proc;
};

const writeAcceptanceApp = async (root: string) => {
	await mkdir(join(root, 'public'), { recursive: true });
	await mkdir(join(root, 'react/client'), { recursive: true });
	await mkdir(join(root, 'react/pages'), { recursive: true });
	await mkdir(join(root, 'src'), { recursive: true });

	await writeFile(
		join(root, 'package.json'),
		`${JSON.stringify(
			{
				dependencies: {
					'@absolutejs/absolute': 'beta',
					'@vitejs/plugin-react': 'latest',
					elysia: 'latest',
					react: 'latest',
					'react-dom': 'latest'
				},
				devDependencies: {
					typescript: 'latest'
				},
				name: 'absolute-compile-published-beta-acceptance',
				private: true,
				scripts: {
					compile:
						'absolute compile server.ts --config absolute.config.ts'
				},
				type: 'module'
			},
			null,
			'\t'
		)}\n`
	);

	await writeFile(
		join(root, 'absolute.config.ts'),
		`import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: './dist',
	preRender: {
		crawl: true,
		enabled: true,
		routes: ['/']
	},
	publicDirectory: './public',
	reactDirectory: './react',
	root: '.'
});
`
	);

	await writeFile(
		join(root, 'server.ts'),
		`import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { GoodPage } from './react/pages/good';
import { DefaultPage } from './react/pages/default';
import { lower } from './react/pages/lower';
import { MultiPage } from './react/pages/multi';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/', () =>
		handleReactPageRequest({
			Page: GoodPage,
			index: asset(manifest, 'GoodIndex')
		})
	)
	.get('/default', () =>
		handleReactPageRequest({
			Page: DefaultPage,
			index: asset(manifest, 'DefaultIndex')
		})
	)
	.get('/lower', () =>
		handleReactPageRequest({
			Page: lower,
			index: asset(manifest, 'LowerIndex')
		})
	)
	.get('/multi', () =>
		handleReactPageRequest({
			Page: MultiPage,
			index: asset(manifest, 'MultiIndex')
		})
	)
	.get('/api/env', () => ({
		secret: process.env.COMPILE_ACCEPTANCE_SECRET ?? null
	}))
	.get('/api/runtime-file', () =>
		Bun.file(new URL('./src/runtime.txt', import.meta.url)).text()
	)
	.use(networking);
`
	);

	await writeFile(
		join(root, 'react/pages/good.tsx'),
		`import { useEffect, useState } from 'react';

export function GoodPage() {
	const [clientReady, setClientReady] = useState('CLIENT_PENDING');
	const [count, setCount] = useState(0);

	useEffect(() => {
		setClientReady('CLIENT_READY');
		import('../client/dynamicFeature').then((mod) => {
			document.querySelector('#dynamic-client')!.textContent = mod.message;
		});
		const worker = new Worker(new URL('../client/featureWorker.ts', import.meta.url), {
			type: 'module'
		});
		worker.onmessage = (event) => {
			document.querySelector('#worker-client')!.textContent = event.data;
			worker.terminate();
		};
		worker.postMessage('beta');
	}, []);

	return (
		<html>
			<head>
				<title>Compile Published Beta Acceptance</title>
				<link rel="stylesheet" href="/style.css" />
			</head>
			<body>
				<h1>GOOD_PAGE</h1>
				<p className="status">STYLE_READY</p>
				<p id="client-ready">{clientReady}</p>
				<p id="dynamic-client">DYNAMIC_PENDING</p>
				<p id="worker-client">WORKER_PENDING</p>
				<button id="increment" onClick={() => setCount(count + 1)}>
					Count {count}
				</button>
				<a href="/default">Default</a>
			</body>
		</html>
	);
}
`
	);

	await writeFile(
		join(root, 'react/pages/default.tsx'),
		`export default function DefaultExportPage() {
	return (
		<html>
			<body>
				<h1>DEFAULT_PAGE</h1>
			</body>
		</html>
	);
}

export { DefaultExportPage as DefaultPage };
`
	);

	await writeFile(
		join(root, 'react/pages/lower.tsx'),
		`export function lower() {
	return (
		<html>
			<body>
				<h1>LOWER_PAGE</h1>
			</body>
		</html>
	);
}
`
	);

	await writeFile(
		join(root, 'react/pages/multi.tsx'),
		`export function HelperComponent() {
	return <p>helper</p>;
}

export function MultiPage() {
	return (
		<html>
			<body>
				<h1>MULTI_PAGE</h1>
			</body>
		</html>
	);
}
`
	);

	await writeFile(
		join(root, 'react/client/dynamicFeature.ts'),
		`export const message = 'DYNAMIC_CLIENT_READY';
`
	);
	await writeFile(
		join(root, 'react/client/featureWorker.ts'),
		`self.onmessage = (event) => {
	self.postMessage(\`WORKER_CLIENT_READY_\${event.data}\`);
};
`
	);
	await writeFile(
		join(root, 'public/style.css'),
		`.status {
	color: rgb(12, 119, 92);
}
`
	);
	await writeFile(join(root, 'src/runtime.txt'), 'RUNTIME_FILE_READY\n');
};

const assertHttpAcceptance = async (baseUrl: string) => {
	const assertPage = async (path: string, marker: string) => {
		const response = await fetch(`${baseUrl}${path}`);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain(marker);
	};

	await assertPage('/', 'GOOD_PAGE');
	await assertPage('/default', 'DEFAULT_PAGE');
	await assertPage('/lower', 'LOWER_PAGE');
	await assertPage('/multi', 'MULTI_PAGE');

	const css = await fetch(`${baseUrl}/style.css`);
	expect(css.status).toBe(200);
	expect(await css.text()).toContain('rgb(12, 119, 92)');

	const env = await fetch(`${baseUrl}/api/env`);
	expect(env.status).toBe(200);
	expect(await env.json()).toEqual({ secret: 'beta-secret' });

	const runtimeFile = await fetch(`${baseUrl}/api/runtime-file`);
	expect(runtimeFile.status).toBe(200);
	expect(await runtimeFile.text()).toContain('RUNTIME_FILE_READY');
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

const assertBrowserAcceptance = async (baseUrl: string) => {
	const { WebView } = Bun as unknown as {
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
	};
	if (!WebView) return;

	const consoleErrors: unknown[] = [];
	const failedRequests: unknown[] = [];
	const isImplicitBrowserRequest = (url?: string) =>
		url ? new URL(url).pathname === '/favicon.ico' : false;
	let view: InstanceType<NonNullable<typeof WebView>> | undefined;

	try {
		view = new WebView({
			backend: 'chrome',
			height: 720,
			width: 1280,
			console: (type: string, ...args: unknown[]) => {
				if (type === 'error') consoleErrors.push(args);
			}
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
			`Skipping Bun.WebView published compile probe: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
		view?.close();

		return;
	}

	try {
		await view.navigate(baseUrl.replace('localhost', '127.0.0.1'));
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
		expect(
			await waitForEvaluate(
				view,
				"document.querySelector('#dynamic-client')?.textContent ?? ''",
				(value) => value === 'DYNAMIC_CLIENT_READY'
			)
		).toBe('DYNAMIC_CLIENT_READY');
		expect(
			await waitForEvaluate(
				view,
				"document.querySelector('#worker-client')?.textContent ?? ''",
				(value) => value === 'WORKER_CLIENT_READY_beta'
			)
		).toBe('WORKER_CLIENT_READY_beta');
		expect(
			await view.evaluate<string>(
				"getComputedStyle(document.querySelector('.status')).color"
			)
		).toBe('rgb(12, 119, 92)');

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

afterEach(async () => {
	for (const proc of [...serverProcesses]) {
		await stopProcess(proc);
	}
	for (const root of [...tempRoots]) {
		await rm(root, { force: true, recursive: true }).catch(() => {});
		tempRoots.delete(root);
	}
});

describe('published beta compile acceptance', () => {
	publishedBetaTest(
		'compiles and runs a fresh npm beta app from only the copied executable',
		async () => {
			const appRoot = await makeTempDir('absolute-compile-published-app');
			await writeAcceptanceApp(appRoot);

			await runProcess(['bun', 'install'], {
				cwd: appRoot,
				timeoutMs: 120_000
			});
			await runProcess(['bun', 'run', 'compile'], {
				cwd: appRoot,
				timeoutMs: 180_000
			});

			const runRoot = await makeTempDir('absolute-compile-published-run');
			await copyFile(
				join(appRoot, 'compiled-server'),
				join(runRoot, 'compiled-server')
			);
			await chmod(join(runRoot, 'compiled-server'), 0o755);

			const port = await getAvailablePort();
			const proc = await startCompiledServer(runRoot, port, {
				COMPILE_ACCEPTANCE_SECRET: 'beta-secret'
			});
			const baseUrl = `http://localhost:${port}`;

			await assertHttpAcceptance(baseUrl);
			await assertBrowserAcceptance(baseUrl);

			await stopProcess(proc);
		},
		240_000
	);
});
