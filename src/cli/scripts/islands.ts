import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { loadIslandRegistryBuildInfo } from '../../build/islandEntries';
import { getIslandManifestKey } from '../../core/islandManifest';
import { loadPageIslandMetadata } from '../../islands/pageMetadata';
import { loadConfig } from '../../utils/loadConfig';
import { formatBytes } from '../../utils/formatBytes';
import { colors, padLine } from '../tuiPrimitives';
import type { BuildConfig } from '../../../types/build';
import type { IslandFramework } from '../../../types/island';

const FRAMEWORK_DIR_KEY: Record<string, keyof BuildConfig> = {
	angular: 'angularDirectory',
	html: 'htmlDirectory',
	htmx: 'htmxDirectory',
	react: 'reactDirectory',
	svelte: 'svelteDirectory',
	vue: 'vueDirectory'
};

const FRAMEWORK_COLOR: Record<string, string> = {
	angular: colors.red,
	html: colors.yellow,
	htmx: colors.yellow,
	react: colors.cyan,
	svelte: colors.red,
	vue: colors.green
};

type Mount = {
	crossFramework: boolean;
	hostFramework: string | null;
	hydrate: string;
	page: string;
};

type IslandInfo = {
	component: string;
	framework: IslandFramework;
	mounts: Mount[];
	size: number | null;
	source: string | null;
};

const printDim = (message: string) =>
	process.stdout.write(`${colors.dim}${message}${colors.reset}\n`);

// Infer the framework of the host page from which configured directory it lives
// under — so we can flag a React island mounted inside a Vue page, etc.
const hostFrameworkOf = (
	pagePath: string,
	cwd: string,
	config: BuildConfig
) => {
	const resolved = resolve(cwd, pagePath);
	for (const [framework, key] of Object.entries(FRAMEWORK_DIR_KEY)) {
		const dir = config[key];
		if (typeof dir === 'string' && resolved.startsWith(resolve(cwd, dir))) {
			return framework;
		}
	}

	return null;
};

const fileSize = (path: string) => {
	try {
		return statSync(path).size;
	} catch {
		return 0;
	}
};

const readManifestSizes = (manifestDir: string) => {
	const manifestPath = join(manifestDir, 'manifest.json');
	if (!existsSync(manifestPath)) return null;
	const manifest: Record<string, string> = JSON.parse(
		readFileSync(manifestPath, 'utf-8')
	);
	const sizes = new Map<string, number>();
	for (const [key, value] of Object.entries(manifest)) {
		sizes.set(key, fileSize(join(manifestDir, value.replace(/^\//, ''))));
	}

	return sizes;
};

const collectIslands = async (
	cwd: string,
	config: BuildConfig,
	sizes: Map<string, number> | null
) => {
	const registryPath = config.islands?.registry;
	if (typeof registryPath !== 'string') return null;

	const buildInfo = await loadIslandRegistryBuildInfo(
		resolve(cwd, registryPath)
	);
	const pageMetadata = await loadPageIslandMetadata(config);
	const usages = [...pageMetadata.values()].flatMap((meta) =>
		meta.islands.map((island) => ({ ...island, page: meta.pagePath }))
	);

	return buildInfo.definitions.map((definition): IslandInfo => {
		const mounts = usages
			.filter(
				(usage) =>
					usage.framework === definition.framework &&
					usage.component === definition.component
			)
			.map((usage): Mount => {
				const hostFramework = hostFrameworkOf(usage.page, cwd, config);

				return {
					crossFramework:
						hostFramework !== null &&
						hostFramework !== definition.framework,
					hostFramework,
					hydrate: usage.hydrate ?? 'load',
					page: relative(cwd, resolve(cwd, usage.page))
				};
			});
		const key = getIslandManifestKey(
			definition.framework,
			definition.component
		);

		return {
			component: definition.component,
			framework: definition.framework,
			mounts,
			size: sizes?.get(key) ?? null,
			source: definition.buildReference?.source ?? null
		};
	});
};

type PageGroup = {
	crossFramework: boolean;
	hostFramework: string | null;
	hydrates: Set<string>;
};

// Collapse repeated mounts of the same island on one page into a single row,
// joining their hydration strategies (load/idle/visible).
const groupByPage = (mounts: Mount[]) => {
	const byPage = new Map<string, PageGroup>();
	for (const mount of mounts) {
		const entry = byPage.get(mount.page) ?? {
			crossFramework: mount.crossFramework,
			hostFramework: mount.hostFramework,
			hydrates: new Set<string>()
		};
		entry.hydrates.add(mount.hydrate);
		byPage.set(mount.page, entry);
	}

	return [...byPage.entries()].map(([page, entry]) => ({
		crossFramework: entry.crossFramework,
		hostFramework: entry.hostFramework,
		hydrate: [...entry.hydrates].join(', '),
		page
	}));
};

const renderIsland = (island: IslandInfo, cwd: string) => {
	const color = FRAMEWORK_COLOR[island.framework] ?? colors.reset;
	const pages = groupByPage(island.mounts);
	const crossCount = pages.filter((page) => page.crossFramework).length;
	const sizeText =
		island.size === null
			? ''
			: ` ${colors.dim}${formatBytes(island.size)}${colors.reset}`;
	const meta = `${colors.dim}${island.framework} · ${pages.length} page${pages.length === 1 ? '' : 's'}${crossCount > 0 ? ` · ${crossCount} cross-framework` : ''}${colors.reset}`;
	const lines = [
		`  ${color}⬡${colors.reset} ${colors.bold}${island.component}${colors.reset}  ${meta}${sizeText}`
	];
	if (island.source) {
		lines.push(
			`    ${colors.dim}${relative(cwd, island.source)}${colors.reset}`
		);
	}
	if (pages.length === 0) {
		lines.push(
			`    ${colors.dim}(registered but not mounted on any page)${colors.reset}`
		);
	}
	const pageWidth = Math.max(0, ...pages.map((page) => page.page.length));
	for (const page of pages) {
		const tag = page.crossFramework
			? ` ${colors.yellow}→ in ${page.hostFramework}${colors.reset}`
			: '';
		lines.push(
			`    ${padLine(page.page, pageWidth)}  ${colors.cyan}${page.hydrate}${colors.reset}${tag}`
		);
	}

	return lines.join('\n');
};

const summarize = (islands: IslandInfo[]) => {
	const frameworks = new Set(islands.map((island) => island.framework));
	const mounts = islands.reduce(
		(sum, island) => sum + island.mounts.length,
		0
	);
	const crossFramework = islands.reduce(
		(sum, island) =>
			sum + island.mounts.filter((mount) => mount.crossFramework).length,
		0
	);

	return `${islands.length} islands · ${frameworks.size} frameworks · ${mounts} mounts · ${crossFramework} cross-framework`;
};

export const runIslands = async (args: string[]) => {
	const cwd = process.cwd();
	const configIndex = args.indexOf('--config');
	const configPath = configIndex >= 0 ? args[configIndex + 1] : undefined;
	let config: BuildConfig;
	try {
		config = await loadConfig(configPath);
	} catch (error) {
		printDim(error instanceof Error ? error.message : String(error));

		return;
	}

	const outdirIndex = args.indexOf('--outdir');
	const outdir =
		outdirIndex >= 0 ? args[outdirIndex + 1] : config.buildDirectory;
	const sizes = args.includes('--sizes')
		? readManifestSizes(resolve(cwd, outdir ?? 'build'))
		: null;

	const islands = await collectIslands(cwd, config, sizes);
	if (islands === null) {
		printDim(
			'No island registry configured. Set `islands: { registry: "..." }` in absolute.config.ts.'
		);

		return;
	}

	if (args.includes('--json')) {
		process.stdout.write(`${JSON.stringify(islands, null, 2)}\n`);

		return;
	}

	if (islands.length === 0) {
		printDim('No islands found in the registry.');

		return;
	}

	const sorted = [...islands].sort(
		(left, right) =>
			left.framework.localeCompare(right.framework) ||
			left.component.localeCompare(right.component)
	);
	const blocks = sorted.map((island) => renderIsland(island, cwd));
	process.stdout.write(
		`${blocks.join('\n\n')}\n\n${colors.dim}${summarize(islands)}${colors.reset}\n`
	);
};
