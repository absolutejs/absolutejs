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

/** Maximum number of attempts to poll the server during startup */
const MAX_STARTUP_ATTEMPTS = 50;

/** Milliseconds between each startup readiness poll */
const STARTUP_POLL_INTERVAL_MS = 100;

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

/** Poll the server until it responds with HTTP 200 or we exhaust attempts */
const waitForServerReady = async (port: number) => {
	for (let attempt = 0; attempt < MAX_STARTUP_ATTEMPTS; attempt++) {
		// eslint-disable-next-line no-await-in-loop -- sequential polling: must wait for server readiness
		const res = await fetch(`http://localhost:${port}/`).catch(() => null);
		if (res?.ok) return true;
		// eslint-disable-next-line no-await-in-loop -- sequential polling: must wait between attempts
		await Bun.sleep(STARTUP_POLL_INTERVAL_MS);
	}

	return false;
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
	const serverProcess = Bun.spawn(['bun', 'run', serverBundlePath], {
		cwd: process.cwd(),
		env: { ...process.env, ...env, PORT: String(port) },
		stderr: 'pipe',
		stdout: 'pipe'
	});

	const ready = await waitForServerReady(port);

	if (!ready) {
		serverProcess.kill();
		throw new Error('Server failed to start for pre-rendering');
	}

	const result = await prerender(port, outDir, staticConfig, log);

	serverProcess.kill();
	await serverProcess.exited;

	return result;
};
