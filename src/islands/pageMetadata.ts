import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { BuildConfig } from '../../types/build';
import type { IslandFramework } from '../../types/island';
import { loadIslandRegistryBuildInfo } from '../build/islandEntries';
import { scanEntryPoints } from '../build/scanEntryPoints';
import {
	extractIslandUsagesFromSource,
	type PageIslandUsage
} from './sourceMetadata';

export type PageIslandMetadata = {
	islands: PageIslandUsage[];
	pagePath: string;
};

declare global {
	var __absolutePageIslandMetadata:
		| Map<string, PageIslandMetadata>
		| undefined;
}

const pagePatterns: Partial<Record<IslandFramework | 'html' | 'htmx', string>> =
	{
		angular: 'pages/**/*.{ts,js}',
		html: 'pages/**/*.html',
		htmx: 'pages/**/*.html',
		react: 'pages/**/*.{ts,tsx,js,jsx}',
		svelte: 'pages/**/*.svelte',
		vue: 'pages/**/*.vue'
	};

type PageDirectoryEntry = {
	dir: string;
	framework: keyof typeof pagePatterns;
};

const getPageDirs = (config: BuildConfig) =>
	(
		[
			{ dir: config.angularDirectory, framework: 'angular' },
			{ dir: config.reactDirectory, framework: 'react' },
			{ dir: config.svelteDirectory, framework: 'svelte' },
			{ dir: config.vueDirectory, framework: 'vue' },
			{ dir: config.htmlDirectory, framework: 'html' },
			{ dir: config.htmxDirectory, framework: 'htmx' }
		] satisfies Array<{
			dir: string | undefined;
			framework: keyof typeof pagePatterns;
		}>
	).filter(
		(entry): entry is PageDirectoryEntry =>
			typeof entry.dir === 'string' && entry.dir.length > 0
	);

const buildIslandSourceLookup = async (config: BuildConfig) => {
	const registryPath = config.islands?.registry;
	if (!registryPath) {
		return new Map<string, string>();
	}

	const buildInfo = await loadIslandRegistryBuildInfo(registryPath);
	const lookup = new Map<string, string>();

	for (const definition of buildInfo.definitions) {
		const source = definition.buildReference?.source;
		if (!source) continue;

		const resolvedSource = source.startsWith('file://')
			? new URL(source).pathname
			: resolve(dirname(buildInfo.resolvedRegistryPath), source);

		lookup.set(
			`${definition.framework}:${definition.component}`,
			resolve(resolvedSource)
		);
	}

	return lookup;
};

export const getCurrentPageIslandMetadata = () =>
	globalThis.__absolutePageIslandMetadata ??
	new Map<string, PageIslandMetadata>();
const metadataUsesSource = (metadata: PageIslandMetadata, target: string) =>
	metadata.islands.some((usage) => {
		const candidate = usage.source;

		return candidate ? resolve(candidate) === target : false;
	});

export const getPagesUsingIslandSource = (sourcePath: string) => {
	const target = resolve(sourcePath);

	return [...getCurrentPageIslandMetadata().values()]
		.filter((metadata) => metadataUsesSource(metadata, target))
		.map((metadata) => metadata.pagePath);
};
const resolveIslandUsages = (
	islands: PageIslandUsage[],
	islandSourceLookup: Map<string, string>
) =>
	islands.map((usage) => {
		const sourcePath = islandSourceLookup.get(
			`${usage.framework}:${usage.component}`
		);

		return sourcePath
			? {
					...usage,
					source: sourcePath
				}
			: usage;
	});

const loadPageIslandFiles = async (
	entry: PageDirectoryEntry,
	islandSourceLookup: Map<string, string>,
	pageMetadata: Map<string, PageIslandMetadata>
) => {
	const pattern = pagePatterns[entry.framework];
	if (!pattern) return;

	const files = await scanEntryPoints(resolve(entry.dir), pattern);
	for (const filePath of files) {
		const source = readFileSync(filePath, 'utf-8');
		const islands = extractIslandUsagesFromSource(source);
		pageMetadata.set(resolve(filePath), {
			islands: resolveIslandUsages(islands, islandSourceLookup),
			pagePath: resolve(filePath)
		});
	}
};

export const loadPageIslandMetadata = async (config: BuildConfig) => {
	const pageMetadata = new Map<string, PageIslandMetadata>();
	const islandSourceLookup = await buildIslandSourceLookup(config);

	await Promise.all(
		getPageDirs(config).map((entry) =>
			loadPageIslandFiles(entry, islandSourceLookup, pageMetadata)
		)
	);

	return pageMetadata;
};
export const setCurrentPageIslandMetadata = (
	metadata: Map<string, PageIslandMetadata>
) => {
	globalThis.__absolutePageIslandMetadata = metadata;
};
