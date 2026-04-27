import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StaticConfig } from '../../types/build';

export type PrerenderResult = {
	/** Map of route path → rendered HTML file path on disk */
	routes: Map<string, string>;
	/** Directory where pre-rendered files are stored */
	dir: string;
};

type LogFn = (message: string) => void;

const SERVER_OUTPUT_LIMIT = 4000;

/** Milliseconds between each startup readiness poll */
const STARTUP_POLL_INTERVAL_MS = 100;

/** Default maximum time to wait for the prerender server to become ready. */
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;

/** Header used to bypass the prerender cache during ISR re-renders */
export const PRERENDER_BYPASS_HEADER = 'X-Absolute-Prerender-Bypass';

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
	const res = await fetch(`${baseUrl}${path}`);
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

	while (queue.length > 0) {
		const path = queue.shift();
		if (!path || visited.has(path)) continue;
		visited.add(path);

		// eslint-disable-next-line no-await-in-loop -- sequential crawl: each page discovers new links for the queue
		const html = await fetchRoute(baseUrl, path).catch(() => null);
		if (!html) continue;

		routes.push(path);
		queue.push(...extractLinks(html, visited));
	}

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
		const res = await fetch(`http://localhost:${port}${route}`, {
			headers: { [PRERENDER_BYPASS_HEADER]: '1' }
		});
		if (!res.ok) return false;

		const html = await res.text();
		const fileName = routeToFilename(route);
		const filePath = join(prerenderDir, fileName);
		await Bun.write(filePath, html);
		await writeTimestamp(filePath);

		return true;
	} catch {
		return false;
	}
};

/** Fetch, render, and save a single route during pre-rendering */
const prerenderRoute = async (
	baseUrl: string,
	route: string,
	prerenderDir: string,
	result: PrerenderResult,
	log?: LogFn
) => {
	const res = await fetch(`${baseUrl}${route}`).catch(() => null);
	if (!res) {
		log?.(`  Failed to pre-render ${route}`);

		return;
	}
	if (!res.ok) {
		log?.(`  Skipped ${route} (HTTP ${res.status})`);

		return;
	}

	const html = await res.text();
	const fileName = routeToFilename(route);
	const filePath = join(prerenderDir, fileName);
	await Bun.write(filePath, html);
	await writeTimestamp(filePath);
	result.routes.set(route, filePath);

	log?.(`  Pre-rendered ${route} → ${fileName} (${html.length} bytes)`);
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
		routes: new Map()
	};

	for (const route of routes) {
		// eslint-disable-next-line no-await-in-loop -- sequential pre-rendering to avoid overwhelming the server
		await prerenderRoute(baseUrl, route, prerenderDir, result, log);
	}

	return result;
};

const getStartupTimeoutMs = () => {
	const rawTimeout = Bun.env.ABSOLUTE_PRERENDER_STARTUP_TIMEOUT_MS;
	const parsedTimeout = rawTimeout ? Number(rawTimeout) : NaN;

	return Number.isFinite(parsedTimeout) && parsedTimeout > 0
		? parsedTimeout
		: DEFAULT_STARTUP_TIMEOUT_MS;
};

/** Poll the server until it responds or startup timeout elapses */
const waitForServerReady = async (port: number) => {
	const deadline = performance.now() + getStartupTimeoutMs();
	while (performance.now() < deadline) {
		// eslint-disable-next-line no-await-in-loop -- sequential polling: must wait for server readiness
		if (await probePrerenderServer(port)) {
			return true;
		}
		// eslint-disable-next-line no-await-in-loop -- sequential polling: must wait between attempts
		await Bun.sleep(STARTUP_POLL_INTERVAL_MS);
	}

	return false;
};

const probePrerenderServer = async (port: number) => {
	const res = await fetch(`http://localhost:${port}/`).catch(() => null);
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
				if (done) return;
				output.push(decoder.decode(value, { stream: true }));
				read();
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
	const serverProcess = Bun.spawn(['bun', 'run', serverBundlePath], {
		cwd: process.cwd(),
		env: { ...process.env, ...env, PORT: String(port) },
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
