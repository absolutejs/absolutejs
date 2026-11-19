import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StaticConfig } from '../../types/build';
import { PARTIAL_SHELL_HEADER, writePartialHoles } from './partialPrerender';
import { renderedNonce, writeRenderedNonce } from './prerenderNonce';

export type PrerenderFailure = {
	/** Why the route couldn't be pre-rendered */
	reason: string;
	route: string;
};

export type PrerenderResult = {
	/** Map of route path → rendered HTML file path on disk */
	routes: Map<string, string>;
	/** Directory where pre-rendered files are stored */
	dir: string;
	/** Routes that couldn't be pre-rendered; they render per request */
	failures: PrerenderFailure[];
};

type LogFn = (message: string) => void;

const SERVER_OUTPUT_LIMIT = 4000;

/** Milliseconds between each startup readiness poll */
const STARTUP_POLL_INTERVAL_MS = 100;

/** Default maximum time to wait for the prerender server to become ready. */
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;

/** Default maximum time to wait for any prerender HTTP request. */
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

/** Header used to bypass the prerender cache during ISR re-renders */
export const PRERENDER_BYPASS_HEADER = 'X-Absolute-Prerender-Bypass';

const BYPASS_TOKEN_KEY = Symbol.for('absolutejs.prerenderBypassToken');

const createBypassToken = () => {
	const token =
		process.env.ABSOLUTE_PRERENDER_BYPASS_TOKEN || crypto.randomUUID();
	Reflect.set(globalThis, BYPASS_TOKEN_KEY, token);

	return token;
};

const readBypassToken = () => {
	const existing: unknown = Reflect.get(globalThis, BYPASS_TOKEN_KEY);

	return typeof existing === 'string' ? existing : createBypassToken();
};

/** The value the bypass header has to carry. The header skips the
 *  pre-render cache, so it is a secret of this process rather than a
 *  constant any visitor could send: the server's own re-render and hole
 *  requests know it, and nobody else does. It lives on `globalThis` so two
 *  copies of this module in one process still agree. Set
 *  `ABSOLUTE_PRERENDER_BYPASS_TOKEN` to choose it, for a test or a probe
 *  that needs the uncached page. */
export const PRERENDER_BYPASS_TOKEN = readBypassToken();

export const isPrerenderBypass = (request: Request) =>
	request.headers.get(PRERENDER_BYPASS_HEADER) === PRERENDER_BYPASS_TOKEN;

/** Convert a URL path to a filename: "/" → "index.html", "/vue" → "vue.html" */
export const routeToFilename = (route: string) =>
	route === '/' ? 'index.html' : `${route.slice(1).replace(/\//g, '-')}.html`;

/** Write a timestamp file alongside the pre-rendered HTML */
const writeTimestamp = async (htmlPath: string) => {
	const metaPath = htmlPath.replace(/\.html$/, '.meta');
	await Bun.write(metaPath, String(Date.now()));
};

/** Read the render timestamp for a pre-rendered page. Returns 0 if not found. */
export const readTimestamp = (htmlPath: string) => {
	const metaPath = htmlPath.replace(/\.html$/, '.meta');
	try {
		const content = readFileSync(metaPath, 'utf-8');

		return Number(content) || 0;
	} catch {
		return 0;
	}
};

/** Extract internal <a href> links from an HTML string */
const extractLinks = (html: string, visited: Set<string>) => {
	const links: string[] = [];
	const linkRegex = /href=["'](\/[^"']*?)["']/g;
	let match;
	while ((match = linkRegex.exec(html)) !== null) {
		const href = match[1] ?? '';
		if (
			!href ||
			href.includes('.') ||
			href.includes('#') ||
			visited.has(href)
		)
			continue;
		links.push(href);
	}

	return links;
};

/** Fetch a single route and return its HTML if it's a valid HTML page */
const fetchRoute = async (baseUrl: string, path: string) => {
	const res = await fetchWithTimeout(`${baseUrl}${path}`, {
		redirect: 'manual'
	});
	if (!res.ok) return null;

	const contentType = res.headers.get('content-type') ?? '';
	if (!contentType.includes('text/html')) return null;

	return res.text();
};

/**
 * Crawl from "/" and discover all linked pages by following internal <a href> links.
 */
const crawlRoutes = async (baseUrl: string) => {
	const visited = new Set<string>();
	const queue: string[] = ['/'];
	const routes: string[] = [];

	const crawlNextRoute = async () => {
		const path = queue.shift();
		if (!path) {
			return;
		}
		if (visited.has(path)) {
			await crawlNextRoute();

			return;
		}
		visited.add(path);

		const html = await fetchRoute(baseUrl, path).catch(() => null);
		if (!html) {
			await crawlNextRoute();

			return;
		}

		routes.push(path);
		queue.push(...extractLinks(html, visited));
		await crawlNextRoute();
	};

	await crawlNextRoute();

	return routes;
};

/**
 * Re-render a single route by fetching it from the running server
 * with the bypass header so it hits SSR instead of the cache.
 */
export const rerenderRoute = async (
	route: string,
	port: number,
	prerenderDir: string
) => {
	try {
		const res = await fetchWithTimeout(`http://localhost:${port}${route}`, {
			headers: {
				[PARTIAL_SHELL_HEADER]: '1',
				[PRERENDER_BYPASS_HEADER]: PRERENDER_BYPASS_TOKEN
			},
			redirect: 'manual'
		});
		if (!res.ok) return false;

		const html = await res.text();
		if (!isCompleteHtml(html)) return false;
		const fileName = routeToFilename(route);
		const filePath = join(prerenderDir, fileName);
		await Bun.write(filePath, html);
		await writeRenderedNonce(filePath, renderedNonce(res));
		await writePartialHoles(filePath, res);
		await writeTimestamp(filePath);

		return true;
	} catch {
		return false;
	}
};

const describeError = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/** The line `absolute start` and `absolute compile` print, once, for a
 *  route that couldn't be pre-rendered. */
export const formatPrerenderFailure = ({ reason, route }: PrerenderFailure) =>
	`Could not pre-render ${route}: ${reason}. It renders on each request instead.`;

/** Fetch, render, and save a single route during pre-rendering. Returns why
 *  the route couldn't be pre-rendered, or undefined once it's saved. */
const prerenderRoute = async (
	baseUrl: string,
	route: string,
	prerenderDir: string,
	result: PrerenderResult,
	log?: LogFn
) => {
	// Asks for the static shell: a page with dynamic streaming slots keeps
	// their fallbacks, and they stream per request (partialPrerenderServe.ts).
	const res = await fetchWithTimeout(`${baseUrl}${route}`, {
		headers: { [PARTIAL_SHELL_HEADER]: '1' },
		redirect: 'manual'
	}).catch((error: unknown) => describeError(error));
	if (typeof res === 'string') {
		return `the request failed (${res})`;
	}
	if (!res.ok) {
		await res.body?.cancel().catch(() => undefined);

		return `the route responded with HTTP ${res.status}`;
	}

	const contentType = res.headers.get('content-type') ?? '';
	if (!contentType.includes('text/html')) {
		await res.body?.cancel().catch(() => undefined);

		return `the response is not HTML (content-type: ${contentType || 'none'})`;
	}

	// The whole document: static streaming slots, async resolvers included,
	// are inlined before the stream closes.
	const html = await res.text();
	if (!isCompleteHtml(html)) {
		return 'the rendered HTML document is incomplete (it ends without </html>)';
	}
	const fileName = routeToFilename(route);
	const filePath = join(prerenderDir, fileName);
	await Bun.write(filePath, html);
	// Under secureHeaders(), the nonce this render used; serving swaps it
	// for each request's own (prerenderNonce.ts).
	await writeRenderedNonce(filePath, renderedNonce(res));
	const holes = await writePartialHoles(filePath, res);
	await writeTimestamp(filePath);
	result.routes.set(route, filePath);

	const partial =
		holes.length > 0
			? `, partial: ${holes.length} dynamic slot${holes.length === 1 ? '' : 's'}`
			: '';
	log?.(
		`  Pre-rendered ${route} → ${fileName} (${html.length} bytes${partial})`
	);

	return undefined;
};

const recordPrerenderRoute = async (
	baseUrl: string,
	route: string,
	prerenderDir: string,
	result: PrerenderResult,
	log?: LogFn
) => {
	const reason = await prerenderRoute(
		baseUrl,
		route,
		prerenderDir,
		result,
		log
	).catch((error: unknown) => `rendering it threw (${describeError(error)})`);
	if (reason === undefined) return;

	const failure: PrerenderFailure = { reason, route };
	result.failures.push(failure);
	log?.(`  ${formatPrerenderFailure(failure)}`);
};

/**
 * Pre-render routes by fetching them from a running server and saving the HTML to disk.
 *
 * Used by both `absolute start` (SSG) and `absolute compile`.
 */
export const prerender = async (
	port: number,
	outDir: string,
	staticConfig: StaticConfig,
	log?: LogFn
) => {
	const prerenderDir = join(outDir, '_prerendered');
	mkdirSync(prerenderDir, { recursive: true });

	const baseUrl = `http://localhost:${port}`;

	let routes: string[];
	if (staticConfig.routes === 'all') {
		log?.('Crawling routes...');
		routes = await crawlRoutes(baseUrl);
	} else {
		({ routes } = staticConfig);
	}

	const result: PrerenderResult = {
		dir: prerenderDir,
		failures: [],
		routes: new Map()
	};

	await routes.reduce(
		(chain, route) =>
			chain.then(() =>
				recordPrerenderRoute(baseUrl, route, prerenderDir, result, log)
			),
		Promise.resolve()
	);

	return result;
};

const getStartupTimeoutMs = () => {
	const rawTimeout = Bun.env.ABSOLUTE_PRERENDER_STARTUP_TIMEOUT_MS;
	const parsedTimeout = rawTimeout ? Number(rawTimeout) : NaN;

	return Number.isFinite(parsedTimeout) && parsedTimeout > 0
		? parsedTimeout
		: DEFAULT_STARTUP_TIMEOUT_MS;
};

const getFetchTimeoutMs = () => {
	const rawTimeout = Bun.env.ABSOLUTE_PRERENDER_FETCH_TIMEOUT_MS;
	const parsedTimeout = rawTimeout ? Number(rawTimeout) : NaN;

	return Number.isFinite(parsedTimeout) && parsedTimeout > 0
		? parsedTimeout
		: DEFAULT_FETCH_TIMEOUT_MS;
};

const fetchWithTimeout = (url: string, init: RequestInit = {}) =>
	fetch(url, {
		...init,
		signal: init.signal ?? AbortSignal.timeout(getFetchTimeoutMs())
	});

const isCompleteHtml = (html: string) =>
	!/^(?:\uFEFF)?\s*<!doctype\s+html\b/i.test(html) ||
	/<\/html>\s*$/i.test(html);

/** Poll the server until it responds or startup timeout elapses */
const waitForServerReady = async (port: number) => {
	const deadline = performance.now() + getStartupTimeoutMs();
	const pollServer = async () => {
		if (performance.now() >= deadline) {
			return false;
		}
		if (await probePrerenderServer(port)) {
			return true;
		}
		await Bun.sleep(STARTUP_POLL_INTERVAL_MS);

		return pollServer();
	};

	return pollServer();
};

const probePrerenderServer = async (port: number) => {
	const res = await fetchWithTimeout(`http://localhost:${port}/`, {
		signal: AbortSignal.timeout(Math.min(getFetchTimeoutMs(), 1000))
	}).catch(() => null);
	if (!res) {
		return false;
	}

	await res.body?.cancel().catch(() => undefined);

	return true;
};

const captureStreamOutput = (
	stream: ReadableStream<Uint8Array> | null,
	output: string[]
) => {
	if (!stream) return;

	const reader = stream.getReader();
	const decoder = new TextDecoder();
	const read = () => {
		reader
			.read()
			.then(({ done, value }) => {
				if (done) {
					return undefined;
				}
				output.push(decoder.decode(value, { stream: true }));

				return read();
			})
			.catch(() => {
				/* best-effort diagnostics */
			});
	};
	read();
};

const formatServerOutput = (output: string[]) => {
	const text = output.join('').trim();
	if (!text) return '';

	return text.length > SERVER_OUTPUT_LIMIT
		? text.slice(-SERVER_OUTPUT_LIMIT)
		: text;
};

const createServerStartupError = (output: string[]) => {
	const serverOutput = formatServerOutput(output);
	const message = serverOutput
		? `Server failed to start for pre-rendering.\n\nServer output:\n${serverOutput}`
		: 'Server failed to start for pre-rendering';

	return new Error(message);
};

/**
 * Start the bundled production server, wait for it to be ready, pre-render,
 * then kill it.
 */
export const prerenderWithServer = async (
	serverBundlePath: string,
	port: number,
	outDir: string,
	staticConfig: StaticConfig,
	env: Record<string, string>,
	log?: LogFn
) => {
	const serverOutput: string[] = [];
	// Pin the server to exactly `port` on localhost. networking() resolves its bind
	// as ABSOLUTE_PORT ?? PORT ?? DEFAULT_PORT, so an ABSOLUTE_PORT/ABSOLUTE_HOST
	// inherited from the parent (or a stale config) would otherwise win and make the
	// child bind the wrong (occupied) port while the harness polls this one.
	const serverProcess = Bun.spawn(['bun', 'run', serverBundlePath], {
		cwd: process.cwd(),
		env: {
			...process.env,
			...env,
			ABSOLUTE_HOST: 'localhost',
			ABSOLUTE_PORT: String(port),
			// Never let an inherited value opt this short-lived child into live work.
			ABSOLUTE_PRERENDER: '1',
			HOST: 'localhost',
			PORT: String(port)
		},
		stderr: 'pipe',
		stdout: 'pipe'
	});
	captureStreamOutput(serverProcess.stdout, serverOutput);
	captureStreamOutput(serverProcess.stderr, serverOutput);

	const ready = await waitForServerReady(port);

	if (!ready) {
		serverProcess.kill();
		await serverProcess.exited.catch(() => undefined);
		throw createServerStartupError(serverOutput);
	}

	const result = await prerender(port, outDir, staticConfig, log);

	serverProcess.kill();
	await serverProcess.exited;

	return result;
};
