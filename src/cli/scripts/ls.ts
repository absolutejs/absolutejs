import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BYTES_PER_KILOBYTE, UNFOUND_INDEX } from '../../constants';
import { loadConfig } from '../../utils/loadConfig';
import { colors, padLine, visibleLength } from '../tuiPrimitives';

type EntryKind =
	| 'chunk'
	| 'client'
	| 'css'
	| 'index'
	| 'island'
	| 'page'
	| 'script';

type FrameworkId =
	| 'angular'
	| 'html'
	| 'htmx'
	| 'react'
	| 'shared'
	| 'svelte'
	| 'vue';

type ColumnWidths = { id: number; kind: number; size: number };

type FrameworkGroup = { entries: ManifestEntry[]; framework: FrameworkId };

type KindProbe = { id: string; path: string };

type KindRule = { kind: EntryKind; matches: (probe: KindProbe) => boolean };

type ManifestEntry = {
	framework: FrameworkId;
	id: string;
	kind: EntryKind;
	path: string;
	sizeBytes: number;
};

const DEFAULT_BUILD_DIR = 'build';

// Frameworks whose name appears as a path segment in built artifact paths
// (e.g. `/react/indexes/...`). Anything without one of these — shared chunks,
// global stylesheets — falls back to the `shared` bucket.
const FRAMEWORK_SEGMENTS: FrameworkId[] = [
	'angular',
	'html',
	'htmx',
	'react',
	'svelte',
	'vue'
];

// Display order: SPA frameworks first, then template surfaces, shared last.
const FRAMEWORK_ORDER: FrameworkId[] = [
	'react',
	'vue',
	'svelte',
	'angular',
	'html',
	'htmx',
	'shared'
];

const FRAMEWORK_LABELS: Record<FrameworkId, string> = {
	angular: 'Angular',
	html: 'HTML',
	htmx: 'HTMX',
	react: 'React',
	shared: 'Shared',
	svelte: 'Svelte',
	vue: 'Vue'
};

const KIND_LABELS: Record<EntryKind, string> = {
	chunk: 'chunk',
	client: 'client',
	css: 'css',
	index: 'index',
	island: 'island',
	page: 'page',
	script: 'script'
};

// Sort weight within a framework group: the page first, then its hydration
// entry, client/island bundles, styles, scripts, shared chunks last.
const KIND_RANK: Record<EntryKind, number> = {
	chunk: 6,
	client: 2,
	css: 4,
	index: 1,
	island: 3,
	page: 0,
	script: 5
};

// First matching rule wins, so order is precedence (a `Chunk*` id beats the
// generic page fallback). Keyed off the manifest id and the built artifact path.
const KIND_RULES: KindRule[] = [
	{ kind: 'chunk', matches: (probe) => probe.id.startsWith('Chunk') },
	{ kind: 'css', matches: (probe) => probe.path.endsWith('.css') },
	{ kind: 'page', matches: (probe) => probe.path.endsWith('.html') },
	{ kind: 'island', matches: (probe) => probe.id.startsWith('Island') },
	{ kind: 'index', matches: (probe) => probe.id.endsWith('Index') },
	{ kind: 'client', matches: (probe) => probe.id.endsWith('Client') },
	{ kind: 'page', matches: (probe) => probe.path.includes('/server/') },
	{ kind: 'script', matches: (probe) => probe.path.includes('/scripts/') }
];

const parseConfigArg = (args: string[]) => {
	const index = args.indexOf('--config');
	if (index === UNFOUND_INDEX) return undefined;

	return args[index + 1];
};

const resolveBuildDir = async (configPath: string | undefined) => {
	try {
		const config = await loadConfig(configPath);

		return typeof config.buildDirectory === 'string'
			? config.buildDirectory
			: DEFAULT_BUILD_DIR;
	} catch {
		return DEFAULT_BUILD_DIR;
	}
};

const readManifest = (manifestPath: string) => {
	const parsed: Record<string, string> = JSON.parse(
		readFileSync(manifestPath, 'utf-8')
	);

	return parsed;
};

const detectFramework = (path: string) => {
	const segments = path.toLowerCase().split('/');
	const found = FRAMEWORK_SEGMENTS.find((framework) =>
		segments.includes(framework)
	);

	return found ?? 'shared';
};

const detectKind = (id: string, path: string) => {
	const rule = KIND_RULES.find((entry) => entry.matches({ id, path }));

	return rule?.kind ?? 'page';
};

const resolveDiskPath = (buildDir: string, value: string) => {
	// Server bundles are stored as filesystem-absolute paths; client assets are
	// stored web-root-relative (a leading `/` that maps to the build dir, not
	// the filesystem root). Try the value as-is, then resolve it under build.
	if (existsSync(value)) return value;
	const underBuild = join(buildDir, value);
	if (existsSync(underBuild)) return underBuild;

	return join(process.cwd(), value);
};

const fileSize = (diskPath: string) => {
	try {
		return statSync(diskPath).size;
	} catch {
		return 0;
	}
};

const buildEntries = (manifest: Record<string, string>, buildDir: string) =>
	Object.entries(manifest).map(([id, value]) => ({
		framework: detectFramework(value),
		id,
		kind: detectKind(id, value),
		path: value,
		sizeBytes: fileSize(resolveDiskPath(buildDir, value))
	}));

const sortEntries = (entries: ManifestEntry[]) =>
	[...entries].sort(
		(left, right) =>
			KIND_RANK[left.kind] - KIND_RANK[right.kind] ||
			left.id.localeCompare(right.id)
	);

const groupByFramework = (entries: ManifestEntry[]) =>
	FRAMEWORK_ORDER.map((framework) => ({
		entries: sortEntries(
			entries.filter((entry) => entry.framework === framework)
		),
		framework
	})).filter((group) => group.entries.length > 0);

const formatSize = (bytes: number) => {
	if (bytes === 0) return '-';
	if (bytes < BYTES_PER_KILOBYTE) return `${bytes} B`;
	const kilobytes = bytes / BYTES_PER_KILOBYTE;
	if (kilobytes < BYTES_PER_KILOBYTE) return `${kilobytes.toFixed(1)} KB`;

	return `${(kilobytes / BYTES_PER_KILOBYTE).toFixed(1)} MB`;
};

const padStart = (value: string, width: number) => {
	const padding = width - visibleLength(value);
	if (padding <= 0) return value;

	return `${' '.repeat(padding)}${value}`;
};

const columnWidths = (entries: ManifestEntry[]) => ({
	id: Math.max(...entries.map((entry) => entry.id.length)),
	kind: Math.max(...entries.map((entry) => KIND_LABELS[entry.kind].length)),
	size: Math.max(...entries.map((entry) => formatSize(entry.sizeBytes).length))
});

const sumSizes = (entries: ManifestEntry[]) =>
	entries.reduce((total, entry) => total + entry.sizeBytes, 0);

const pluralFiles = (count: number) => (count === 1 ? 'file' : 'files');

const renderGroupHeader = (group: FrameworkGroup) => {
	const label = FRAMEWORK_LABELS[group.framework];
	const count = group.entries.length;
	const size = formatSize(sumSizes(group.entries));

	return `\n${colors.bold}${label}${colors.reset}${colors.dim} · ${count} ${pluralFiles(count)} · ${size}${colors.reset}`;
};

const renderEntryLine = (entry: ManifestEntry, widths: ColumnWidths) => {
	const id = padLine(entry.id, widths.id);
	const kind = padLine(KIND_LABELS[entry.kind], widths.kind);
	const size = padStart(formatSize(entry.sizeBytes), widths.size);

	return `  ${id}  ${colors.dim}${kind}${colors.reset}  ${size}`;
};

const visibleEntries = (entries: ManifestEntry[], showAll: boolean) =>
	showAll ? entries : entries.filter((entry) => entry.kind !== 'chunk');

const renderChunkSummary = (entries: ManifestEntry[], showAll: boolean) => {
	const chunks = entries.filter((entry) => entry.kind === 'chunk');
	if (showAll || chunks.length === 0) return [];

	return [
		`  ${colors.dim}+ ${chunks.length} shared ${chunks.length === 1 ? 'chunk' : 'chunks'} · ${formatSize(sumSizes(chunks))} (--all to list)${colors.reset}`
	];
};

const renderGroup = (
	group: FrameworkGroup,
	widths: ColumnWidths,
	showAll: boolean
) => [
	renderGroupHeader(group),
	...visibleEntries(group.entries, showAll).map((entry) =>
		renderEntryLine(entry, widths)
	),
	...renderChunkSummary(group.entries, showAll)
];

const renderFooter = (
	entries: ManifestEntry[],
	groupCount: number,
	manifestLabel: string
) =>
	`\n${colors.dim}${groupCount} ${groupCount === 1 ? 'framework' : 'frameworks'} · ${entries.length} ${pluralFiles(entries.length)} · ${formatSize(sumSizes(entries))} · ${manifestLabel}${colors.reset}`;

const printInventory = (
	entries: ManifestEntry[],
	manifestLabel: string,
	showAll: boolean
) => {
	const groups = groupByFramework(entries);
	const widths = columnWidths(entries);
	const lines = [
		...groups.flatMap((group) => renderGroup(group, widths, showAll)),
		renderFooter(entries, groups.length, manifestLabel)
	];
	process.stdout.write(`${lines.join('\n')}\n`);
};

const printNoBuild = (manifestPath: string) => {
	process.stdout.write(
		`${colors.dim}No build found at ${manifestPath}. Run \`absolute build\` (or \`absolute dev\`) first.${colors.reset}\n`
	);
};

export const runLs = async (args: string[]) => {
	// `absolute ls | head` closes the reader early, which surfaces as an async
	// EPIPE on stdout. Exit cleanly instead of crashing with a stack trace.
	process.stdout.on('error', (error) => {
		if (
			error instanceof Error &&
			'code' in error &&
			error.code === 'EPIPE'
		) {
			process.exit(0);
		}
	});

	const buildDir = await resolveBuildDir(parseConfigArg(args));
	const manifestPath = join(buildDir, 'manifest.json');
	const manifestLabel = relative(process.cwd(), manifestPath) || manifestPath;

	if (!existsSync(manifestPath)) {
		printNoBuild(manifestLabel);

		return;
	}

	const entries = buildEntries(readManifest(manifestPath), buildDir);

	if (args.includes('--json')) {
		process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);

		return;
	}

	if (entries.length === 0) {
		process.stdout.write(
			`${colors.dim}${manifestLabel} is empty — nothing built yet.${colors.reset}\n`
		);

		return;
	}

	printInventory(entries, manifestLabel, args.includes('--all'));
};
