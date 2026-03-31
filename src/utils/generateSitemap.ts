import { write } from 'bun';
import type { SitemapConfig } from '../../types/sitemap';

const DEFAULT_PRIORITY = 0.8;

const escapeXml = (str: string) =>
	str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');

const isExcluded = (path: string, patterns: (string | RegExp)[]) => {
	for (const pattern of patterns) {
		if (typeof pattern === 'string' && path === pattern) return true;
		if (pattern instanceof RegExp && pattern.test(path)) return true;
	}

	return false;
};

const PAGE_HANDLER_NAMES = [
	'handleReactPageRequest',
	'handleSveltePageRequest',
	'handleVuePageRequest',
	'handleAngularPageRequest',
	'handleHTMLPageRequest',
	'handleHTMXPageRequest'
];

const isPageHandler = (handler: unknown) => {
	if (typeof handler !== 'function') return false;
	const source = handler.toString();

	return PAGE_HANDLER_NAMES.some((name) => source.includes(name));
};

const discoverPageRoutes = (
	routes: { method: string; path: string; handler?: unknown }[],
	exclude: (string | RegExp)[]
) => {
	const seen = new Set<string>();

	return routes
		.filter((route) => {
			if (route.method !== 'GET') return false;
			if (route.path.includes('*') || route.path.includes(':'))
				return false;
			if (seen.has(route.path)) return false;
			if (isExcluded(route.path, exclude)) return false;
			if (!isPageHandler(route.handler)) return false;

			seen.add(route.path);

			return true;
		})
		.map((route) => route.path);
};

const buildSitemapXml = (
	pageRoutes: string[],
	baseUrl: string,
	config: SitemapConfig
) => {
	const normalizedBase = baseUrl.replace(/\/$/, '');
	const entries: string[] = [];

	for (const path of pageRoutes) {
		const override = config.overrides?.[path];
		const changefreq =
			override?.changefreq ?? config.defaultChangefreq ?? 'weekly';
		const priority =
			override?.priority ?? config.defaultPriority ?? DEFAULT_PRIORITY;
		const lastmod = override?.lastmod;
		const url = escapeXml(`${normalizedBase}${path}`);

		let entry = `  <url>\n    <loc>${url}</loc>`;

		if (lastmod) entry += `\n    <lastmod>${lastmod}</lastmod>`;

		entry += `\n    <changefreq>${changefreq}</changefreq>`;
		entry += `\n    <priority>${priority}</priority>`;
		entry += '\n  </url>';

		entries.push(entry);
	}

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...entries,
		'</urlset>'
	].join('\n');
};

export const generateSitemap = async (
	routes: { method: string; path: string; handler?: unknown }[],
	serverUrl: string,
	outDir: string,
	config: SitemapConfig = {}
) => {
	const exclude = config.exclude ?? [];
	const discoveredRoutes = discoverPageRoutes(routes, exclude);

	const dynamicRoutes = config.routes ? await config.routes() : [];
	const filteredDynamic = dynamicRoutes.filter(
		(path) => !isExcluded(path, exclude)
	);

	const allRoutes = [...discoveredRoutes, ...filteredDynamic];
	const baseUrl = config.baseUrl ?? serverUrl;
	const xml = buildSitemapXml(allRoutes, baseUrl, config);

	await write(`${outDir}/sitemap.xml`, xml);
};
