import { write } from 'bun';
import type {
	ChangeFrequency,
	SitemapConfig,
	SitemapRouteOverride
} from '../../types/sitemap';
import {
	getOriginalPageHandlerSource,
	isPageHandler
} from '../core/devRouteRegistrationCallsite';
import { analyzeAngularSpaRoutes } from '../angular/staticAnalyzeSpaRoutes';
import { analyzeReactSpaRoutes } from '../react/staticAnalyzeSpaRoutes';
import { analyzeSvelteSpaRoutes } from '../svelte/staticAnalyzeSpaRoutes';
import { analyzeVueSpaRoutes } from '../vue/staticAnalyzeSpaRoutes';
import type { SpaHost } from './spaRouteTypes';

const DEFAULT_PRIORITY = 0.8;

type AppRoute = {
	method: string;
	path: string;
	/** Runtime handler — `.toString()` is read to detect page handlers. */
	handler?: unknown;
	/** Pre-extracted handler source. Set by the build-time route scanner
	 *  in place of `handler` so the page-handler heuristic and the
	 *  `sitemap: { ... }` metadata regex work without instantiating any
	 *  function. Either field is sufficient; if both are set,
	 *  `handlerSource` wins. */
	handlerSource?: string;
};

export type SitemapPipelineConfig = {
	angularDirectory?: string;
	reactDirectory?: string;
	svelteDirectory?: string;
	vueDirectory?: string;
};

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

const stripTrailingWildcard = (path: string) => path.replace(/\/\*+$/, '');

const isWildcardPagePath = (path: string) =>
	path.endsWith('/*') || path.endsWith('*');

type DiscoveredPage = {
	rawPath: string;
	mountPath: string;
	emitTopLevel: boolean;
	sitemap?: SitemapRouteOverride;
};

const SITEMAP_BLOCK_PATTERN = /\bsitemap\s*:\s*\{([^{}]*)\}/;
const SITEMAP_STRING_FIELD_PATTERN =
	/\b(changefreq|lastmod)\s*:\s*['"]([^'"]+)['"]/g;
const SITEMAP_NUMBER_FIELD_PATTERN = /\bpriority\s*:\s*([+-]?\d+(?:\.\d+)?)/g;
const SITEMAP_BOOLEAN_FIELD_PATTERN = /\b(exclude)\s*:\s*(true|false)\b/g;

const VALID_CHANGEFREQ = new Set<ChangeFrequency>([
	'always',
	'hourly',
	'daily',
	'weekly',
	'monthly',
	'yearly',
	'never'
]);

const extractSitemapMetadataFromHandlerSource = (
	source: string
) => {
	const block = SITEMAP_BLOCK_PATTERN.exec(source);
	if (!block) return undefined;
	const body = block[1];
	if (typeof body !== 'string') return undefined;

	const out: SitemapRouteOverride = {};

	SITEMAP_STRING_FIELD_PATTERN.lastIndex = 0;
	let m;
	while ((m = SITEMAP_STRING_FIELD_PATTERN.exec(body)) !== null) {
		const key = m[1];
		const value = m[2];
		if (
			key === 'changefreq' &&
			VALID_CHANGEFREQ.has(value as ChangeFrequency)
		) {
			out.changefreq = value as ChangeFrequency;
		} else if (key === 'lastmod') {
			out.lastmod = value;
		}
	}

	SITEMAP_NUMBER_FIELD_PATTERN.lastIndex = 0;
	while ((m = SITEMAP_NUMBER_FIELD_PATTERN.exec(body)) !== null) {
		const num = parseFloat(m[1]!);
		if (!Number.isNaN(num)) out.priority = num;
	}

	SITEMAP_BOOLEAN_FIELD_PATTERN.lastIndex = 0;
	while ((m = SITEMAP_BOOLEAN_FIELD_PATTERN.exec(body)) !== null) {
		if (m[1] === 'exclude') out.exclude = m[2] === 'true';
	}

	return Object.keys(out).length > 0 ? out : undefined;
};

const PAGE_HANDLER_NAMES = [
	'handleReactPageRequest',
	'handleSveltePageRequest',
	'handleVuePageRequest',
	'handleAngularPageRequest',
	'handleHTMLPageRequest',
	'handleHTMXPageRequest'
];

const sourceMentionsPageHandler = (source: string) =>
	PAGE_HANDLER_NAMES.some((name) => source.includes(name));

const routeHandlerSource = (route: AppRoute) => {
	if (route.handlerSource) return route.handlerSource;

	return getOriginalPageHandlerSource(route.handler);
};

const routeIsPageHandler = (route: AppRoute) => {
	if (route.handlerSource)
		return sourceMentionsPageHandler(route.handlerSource);

	return isPageHandler(route.handler);
};

const sitemapMetadataForRoute = (
	route: AppRoute
) => {
	const source = routeHandlerSource(route);
	if (!source) return undefined;

	return extractSitemapMetadataFromHandlerSource(source);
};

const discoverPageRoutes = (
	routes: AppRoute[],
	exclude: (string | RegExp)[]
) => {
	const seen = new Set<string>();
	const out: DiscoveredPage[] = [];

	for (const route of routes) {
		if (route.method !== 'GET') continue;
		if (route.path.includes(':')) continue;
		const mountPath = stripTrailingWildcard(route.path);
		if (mountPath.includes('*')) continue;
		if (!routeIsPageHandler(route)) continue;
		if (seen.has(mountPath)) continue;
		if (isExcluded(mountPath, exclude)) continue;
		const meta = sitemapMetadataForRoute(route);
		if (meta?.exclude === true) continue;

		seen.add(mountPath);
		out.push({
			emitTopLevel: !isWildcardPagePath(route.path),
			mountPath,
			rawPath: route.path,
			sitemap: meta
		});
	}

	return out;
};

const joinMountAndSubPath = (mount: string, sub: string) => {
	const trimmedMount = mount.replace(/\/+$/, '');
	const trimmedSub = sub.replace(/^\/+/, '');
	if (!trimmedSub) return trimmedMount || '/';
	if (!trimmedMount) return `/${trimmedSub}`;

	return `${trimmedMount}/${trimmedSub}`;
};

const normalizeMountFromBaseHref = (baseHref: string) => {
	const stripped = baseHref.replace(/\/+$/, '');

	return stripped === '' ? '/' : stripped;
};

type ResolvedEntry = {
	path: string;
	override?: SitemapRouteOverride;
};

const buildSitemapXml = (
	entries: ResolvedEntry[],
	baseUrl: string,
	config: SitemapConfig
) => {
	const normalizedBase = baseUrl.replace(/\/$/, '');
	const xml: string[] = [];

	for (const entry of entries) {
		const configOverride = config.overrides?.[entry.path];
		const handlerOverride = entry.override;
		const changefreq =
			configOverride?.changefreq ??
			handlerOverride?.changefreq ??
			config.defaultChangefreq ??
			'weekly';
		const priority =
			configOverride?.priority ??
			handlerOverride?.priority ??
			config.defaultPriority ??
			DEFAULT_PRIORITY;
		const lastmod = configOverride?.lastmod ?? handlerOverride?.lastmod;
		const url = escapeXml(`${normalizedBase}${entry.path}`);

		let block = `  <url>\n    <loc>${url}</loc>`;
		if (lastmod) block += `\n    <lastmod>${lastmod}</lastmod>`;
		block += `\n    <changefreq>${changefreq}</changefreq>`;
		block += `\n    <priority>${priority}</priority>`;
		block += '\n  </url>';

		xml.push(block);
	}

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...xml,
		'</urlset>'
	].join('\n');
};

const collectFrameworkSpaEntries = (
	hosts: SpaHost[],
	mountOverridesByPath: Map<string, SitemapRouteOverride | undefined>,
	exclude: (string | RegExp)[],
	seenPaths: Set<string>
) => {
	const out: ResolvedEntry[] = [];
	for (const host of hosts) {
		const mount = normalizeMountFromBaseHref(host.baseHref);
		if (!mountOverridesByPath.has(mount)) continue;
		const mountOverride = mountOverridesByPath.get(mount);

		for (const route of host.routes) {
			if (route.dynamic) continue;
			if (route.redirected) continue;
			if (route.sitemapExcluded) continue;
			const fullPath = joinMountAndSubPath(mount, route.path);
			if (seenPaths.has(fullPath)) continue;
			if (isExcluded(fullPath, exclude)) continue;
			seenPaths.add(fullPath);
			out.push({ override: mountOverride, path: fullPath });
		}
	}

	return out;
};

const runAnalyzer = async (
	label: string,
	analyzer: () => Promise<SpaHost[]>
) => {
	try {
		return await analyzer();
	} catch (err) {
		console.warn(`[sitemap] ${label} SPA analysis failed:`, err);

		return [];
	}
};

export const generateSitemap = async (
	routes: AppRoute[],
	serverUrl: string,
	outDir: string,
	config: SitemapConfig = {},
	pipelineConfig: SitemapPipelineConfig = {}
) => {
	const exclude = config.exclude ?? [];
	const discoveredPages = discoverPageRoutes(routes, exclude);

	const seenPaths = new Set<string>();
	const entries: ResolvedEntry[] = [];

	for (const page of discoveredPages) {
		if (!page.emitTopLevel) continue;
		if (seenPaths.has(page.mountPath)) continue;
		seenPaths.add(page.mountPath);
		entries.push({ override: page.sitemap, path: page.mountPath });
	}

	const wildcardOverrides = new Map<
		string,
		SitemapRouteOverride | undefined
	>();
	for (const page of discoveredPages) {
		if (page.emitTopLevel) continue;
		wildcardOverrides.set(page.mountPath, page.sitemap);
	}

	const analyzerJobs: Promise<SpaHost[]>[] = [];
	if (pipelineConfig.angularDirectory) {
		analyzerJobs.push(
			runAnalyzer('Angular', () =>
				analyzeAngularSpaRoutes(pipelineConfig.angularDirectory!)
			)
		);
	}
	if (pipelineConfig.reactDirectory) {
		analyzerJobs.push(
			runAnalyzer('React', () =>
				analyzeReactSpaRoutes(pipelineConfig.reactDirectory!)
			)
		);
	}
	if (pipelineConfig.svelteDirectory) {
		analyzerJobs.push(
			runAnalyzer('Svelte', () =>
				analyzeSvelteSpaRoutes(pipelineConfig.svelteDirectory!)
			)
		);
	}
	if (pipelineConfig.vueDirectory) {
		analyzerJobs.push(
			runAnalyzer('Vue', () =>
				analyzeVueSpaRoutes(pipelineConfig.vueDirectory!)
			)
		);
	}

	const allHosts = (await Promise.all(analyzerJobs)).flat();
	const spaEntries = collectFrameworkSpaEntries(
		allHosts,
		wildcardOverrides,
		exclude,
		seenPaths
	);
	entries.push(...spaEntries);

	const dynamicRoutes = config.routes ? await config.routes() : [];
	for (const path of dynamicRoutes) {
		if (seenPaths.has(path)) continue;
		if (isExcluded(path, exclude)) continue;
		seenPaths.add(path);
		entries.push({ path });
	}

	const baseUrl = config.baseUrl ?? serverUrl;
	const xml = buildSitemapXml(entries, baseUrl, config);

	await write(`${outDir}/sitemap.xml`, xml);
};
