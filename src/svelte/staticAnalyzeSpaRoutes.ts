import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { SpaHost, SpaRoute } from '../utils/spaRouteTypes';

const DYNAMIC_SEGMENT_PATTERN = /^[:*]/;

const pathHasDynamic = (path: string) =>
	path
		.split('/')
		.some((seg) => DYNAMIC_SEGMENT_PATTERN.test(seg) || seg === '**');

const joinSegments = (parent: string, child: string): string => {
	if (!child) return parent;
	if (!parent) return child;

	return `${parent.replace(/\/+$/, '')}/${child.replace(/^\/+/, '')}`;
};

const readAttribute = (tag: string, name: string): string | null => {
	const re = new RegExp(
		`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{?["']([^"']+)["']\\}?)`
	);
	const match = re.exec(tag);

	return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
};

const ROUTER_OPEN_TAG_PATTERN = /<Router\b([^>]*)>/g;
const ROUTE_TAG_PATTERN = /<Route\b([^>]*)\/?>/g;

const findRouterBlock = (
	source: string
): { basepath: string; body: string } | null => {
	const openMatch = ROUTER_OPEN_TAG_PATTERN.exec(source);
	ROUTER_OPEN_TAG_PATTERN.lastIndex = 0;
	if (!openMatch) return null;
	const attrs = openMatch[1] ?? '';
	const basepathRaw = readAttribute(`<Router ${attrs}>`, 'basepath');
	const basepath = basepathRaw ?? '/';

	const closeIndex = source.indexOf('</Router>', openMatch.index);
	if (closeIndex === -1) return null;
	const body = source.slice(
		openMatch.index + openMatch[0].length,
		closeIndex
	);

	return { basepath, body };
};

const extractRoutesFromBody = (body: string): SpaRoute[] => {
	const out: SpaRoute[] = [];
	let match;
	ROUTE_TAG_PATTERN.lastIndex = 0;
	while ((match = ROUTE_TAG_PATTERN.exec(body)) !== null) {
		const attrs = match[1] ?? '';
		const path = readAttribute(`<Route ${attrs}/>`, 'path');
		if (!path) continue;

		out.push({
			dynamic: pathHasDynamic(path),
			path,
			redirected: false,
			sitemapExcluded: false
		});
	}

	return out;
};

const analyzeFile = async (filePath: string): Promise<SpaHost | null> => {
	let source: string;
	try {
		source = await fs.readFile(filePath, 'utf-8');
	} catch {
		return null;
	}

	if (!source.includes('<Router')) return null;

	const block = findRouterBlock(source);
	if (!block) return null;

	const routes = extractRoutesFromBody(block.body);
	if (routes.length === 0) return null;

	const baseHref = block.basepath.endsWith('/')
		? block.basepath
		: `${block.basepath}/`;

	const joinedRoutes: SpaRoute[] = routes.map((r) => ({
		...r,
		path: joinSegments('', r.path)
	}));

	return { baseHref, routes: joinedRoutes, sourceFile: filePath };
};

const walkSvelteFiles = async (dir: string, out: string[]): Promise<void> => {
	let items: import('node:fs').Dirent[];
	try {
		items = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const item of items) {
		if (item.name === 'node_modules' || item.name.startsWith('.')) continue;
		const full = join(dir, item.name);
		if (item.isDirectory()) {
			await walkSvelteFiles(full, out);
		} else if (item.isFile() && item.name.endsWith('.svelte')) {
			out.push(full);
		}
	}
};

/** Statically scan a Svelte page-source directory for SPA hosts —
 *  `.svelte` files that contain a `<Router basepath="...">` block from
 *  AbsoluteJS's Svelte router with one or more `<Route path="...">`
 *  children. Regex-based since `.svelte` files aren't directly TS-AST
 *  parseable; covers the common case where the markup is literal. */
export const analyzeSvelteSpaRoutes = async (
	svelteDirectory: string
): Promise<SpaHost[]> => {
	if (!existsSync(svelteDirectory)) return [];

	const files: string[] = [];
	await walkSvelteFiles(svelteDirectory, files);

	const hosts: SpaHost[] = [];
	await Promise.all(
		files.map(async (file) => {
			try {
				const host = await analyzeFile(file);
				if (host) hosts.push(host);
			} catch (err) {
				console.warn(
					`[sitemap] Svelte SPA analysis failed for ${file}:`,
					err
				);
			}
		})
	);

	return hosts;
};
