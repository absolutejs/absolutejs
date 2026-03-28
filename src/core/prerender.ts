import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { StaticConfig } from '../../types/build';

export type PrerenderResult = {
	/** Map of route path → rendered HTML file path on disk */
	routes: Map<string, string>;
	/** Directory where pre-rendered files are stored */
	dir: string;
};

type LogFn = (message: string) => void;

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
export const readTimestamp = (htmlPath: string): number => {
	const metaPath = htmlPath.replace(/\.html$/, '.meta');
	try {
		const content = require('node:fs').readFileSync(metaPath, 'utf-8');
		return Number(content) || 0;
	} catch {
		return 0;
	}
};

/**
 * Crawl from "/" and discover all linked pages by following internal <a href> links.
 */
const crawlRoutes = async (baseUrl: string): Promise<string[]> => {
	const visited = new Set<string>();
	const queue: string[] = ['/'];
	const routes: string[] = [];

	while (queue.length > 0) {
		const path = queue.shift()!;
		if (visited.has(path)) continue;
		visited.add(path);

		try {
			const res = await fetch(`${baseUrl}${path}`);
			if (!res.ok) continue;

			const contentType = res.headers.get('content-type') ?? '';
			if (!contentType.includes('text/html')) continue;

			const html = await res.text();
			routes.push(path);

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
				queue.push(href);
			}
		} catch {
			/* skip failed routes */
		}
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
): Promise<boolean> => {
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
): Promise<PrerenderResult> => {
	const prerenderDir = join(outDir, '_prerendered');
	mkdirSync(prerenderDir, { recursive: true });

	const baseUrl = `http://localhost:${port}`;

	let routes: string[];
	if (staticConfig.routes === 'all') {
		log?.('Crawling routes...');
		routes = await crawlRoutes(baseUrl);
	} else {
		routes = staticConfig.routes;
	}

	const result: PrerenderResult = {
		routes: new Map(),
		dir: prerenderDir
	};

	for (const route of routes) {
		try {
			const res = await fetch(`${baseUrl}${route}`);
			if (!res.ok) {
				log?.(`  Skipped ${route} (HTTP ${res.status})`);
				continue;
			}

			const html = await res.text();
			const fileName = routeToFilename(route);
			const filePath = join(prerenderDir, fileName);
			await Bun.write(filePath, html);
			await writeTimestamp(filePath);
			result.routes.set(route, filePath);

			log?.(
				`  Pre-rendered ${route} → ${fileName} (${html.length} bytes)`
			);
		} catch {
			log?.(`  Failed to pre-render ${route}`);
		}
	}

	return result;
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
): Promise<PrerenderResult> => {
	const serverProcess = Bun.spawn(['bun', 'run', serverBundlePath], {
		cwd: process.cwd(),
		env: { ...process.env, ...env, PORT: String(port) },
		stdout: 'pipe',
		stderr: 'pipe'
	});

	let ready = false;
	for (let i = 0; i < 50; i++) {
		try {
			const res = await fetch(`http://localhost:${port}/`);
			if (res.ok) {
				ready = true;
				break;
			}
		} catch {
			/* not ready yet */
		}
		await Bun.sleep(100);
	}

	if (!ready) {
		serverProcess.kill();
		throw new Error('Server failed to start for pre-rendering');
	}

	const result = await prerender(port, outDir, staticConfig, log);

	serverProcess.kill();
	await serverProcess.exited;

	return result;
};
