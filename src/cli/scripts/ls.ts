import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { scanConventions } from '../../build/scanConventions';
import { BYTES_PER_KILOBYTE, UNFOUND_INDEX } from '../../constants';
import { getDurationString } from '../../utils/getDurationString';
import { isWorkspaceConfig, loadRawConfig } from '../../utils/loadConfig';
import { toPascal } from '../../utils/stringModifiers';
import { colors, padLine, visibleLength } from '../tuiPrimitives';

type RawConfig = Awaited<ReturnType<typeof loadRawConfig>>;

type ColumnWidths = { name: number; size: number };

type ConfigCandidate = { baseDir: string; source: object };

type FrameworkField = { field: string; label: string; pattern: string };

type ResolvedSpec = { dir: string; label: string; pattern: string };

type PageEntry = {
	name: string;
	sizeBytes: number | null;
	sourcePath: string;
};

type FrameworkGroup = { label: string; pages: PageEntry[] };

const DEFAULT_BUILD_DIR = 'build';

const LABEL_ORDER = ['React', 'Vue', 'Svelte', 'Angular', 'HTML', 'HTMX'];

// Suffixes the build appends to a page's PascalCase base name (server bundle,
// hydration entry, client/island bundle, stylesheet). Summed for --sizes so a
// page's number reflects everything it ships.
const ARTIFACT_SUFFIXES = [
	'',
	'Page',
	'Index',
	'Client',
	'BundledCSS',
	'CompiledCSS',
	'CSS'
];

// Page discovery mirrors the build: `<frameworkDir>/pages` scanned with the
// framework's glob (see src/core/build.ts). Source is the only thing that is
// always current — independent of dev/start/compile or whether anything is built.
const FRAMEWORK_FIELDS: FrameworkField[] = [
	{ field: 'reactDirectory', label: 'React', pattern: '*.tsx' },
	{ field: 'vueDirectory', label: 'Vue', pattern: '*.vue' },
	{ field: 'svelteDirectory', label: 'Svelte', pattern: '*.svelte' },
	{ field: 'angularDirectory', label: 'Angular', pattern: '**/*.ts' },
	{ field: 'htmlDirectory', label: 'HTML', pattern: '*.html' },
	{ field: 'htmxDirectory', label: 'HTMX', pattern: '*.html' }
];

const readStringField = (source: object, key: string) => {
	const value: unknown = Reflect.get(source, key);

	return typeof value === 'string' ? value : undefined;
};

const parseFlagValue = (args: string[], flag: string) => {
	const index = args.indexOf(flag);
	if (index === UNFOUND_INDEX) return undefined;

	return args[index + 1];
};

const loadRawConfigSafe = async (configPath: string | undefined) => {
	try {
		return await loadRawConfig(configPath);
	} catch {
		return null;
	}
};

const relativeOrSelf = (target: string) =>
	relative(process.cwd(), target) || target;

// One config (cwd-relative) for a single-service project; one per service for a
// workspace, each rooted at the service's own cwd.
const configCandidates = (raw: RawConfig) =>
	isWorkspaceConfig(raw)
		? Object.values(raw).map((service) => ({
				baseDir: readStringField(service, 'cwd') ?? '.',
				source: service
			}))
		: [{ baseDir: '.', source: raw }];

const specsFor = (source: object, baseDir: string) =>
	FRAMEWORK_FIELDS.flatMap((framework) => {
		const dir = readStringField(source, framework.field);

		return dir === undefined
			? []
			: [
					{
						dir: join(baseDir, dir),
						label: framework.label,
						pattern: framework.pattern
					}
				];
	});

const scanFramework = async (spec: ResolvedSpec) => {
	const { pageFiles } = await scanConventions(
		join(spec.dir, 'pages'),
		spec.pattern
	);
	if (pageFiles.length === 0) return null;
	const pages: PageEntry[] = pageFiles.map((file) => ({
		name: basename(file, extname(file)),
		sizeBytes: null,
		sourcePath: relativeOrSelf(file)
	}));

	return { label: spec.label, pages };
};

const sortPages = (pages: PageEntry[]) =>
	[...pages].sort((left, right) => left.name.localeCompare(right.name));

const mergeByLabel = (groups: FrameworkGroup[]) => {
	const byLabel = new Map<string, PageEntry[]>();
	groups.forEach((group) => {
		byLabel.set(group.label, [
			...(byLabel.get(group.label) ?? []),
			...group.pages
		]);
	});

	return LABEL_ORDER.flatMap((label) => {
		const pages = byLabel.get(label);

		return pages ? [{ label, pages: sortPages(pages) }] : [];
	});
};

const resolveDiskPath = (buildDir: string, value: string) => {
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

const readManifestSizes = (manifestDir: string) => {
	const manifest: Record<string, string> = JSON.parse(
		readFileSync(join(manifestDir, 'manifest.json'), 'utf-8')
	);
	const sizes = new Map<string, number>();
	Object.entries(manifest).forEach(([key, value]) => {
		sizes.set(key, fileSize(resolveDiskPath(manifestDir, value)));
	});

	return sizes;
};

const pageSizer = (sizes: Map<string, number>) => (name: string) => {
	const base = toPascal(name);
	const total = ARTIFACT_SUFFIXES.reduce(
		(sum, suffix) => sum + (sizes.get(`${base}${suffix}`) ?? 0),
		0
	);

	return total > 0 ? total : null;
};

const withSizes = (
	groups: FrameworkGroup[],
	sizeOf: (name: string) => number | null
) =>
	groups.map((group) => ({
		label: group.label,
		pages: group.pages.map((page) => ({
			name: page.name,
			sizeBytes: sizeOf(page.name),
			sourcePath: page.sourcePath
		}))
	}));

const manifestAge = (manifestPath: string) =>
	getDurationString(Date.now() - statSync(manifestPath).mtimeMs);

const firstBuildDir = (candidates: ConfigCandidate[]) =>
	candidates
		.map((candidate) => {
			const dir = readStringField(candidate.source, 'buildDirectory');

			return dir === undefined ? undefined : join(candidate.baseDir, dir);
		})
		.find((dir) => dir !== undefined);

const resolveSizesDir = (args: string[], candidates: ConfigCandidate[]) =>
	parseFlagValue(args, '--outdir') ??
	firstBuildDir(candidates) ??
	DEFAULT_BUILD_DIR;

const formatSize = (bytes: number | null) => {
	if (bytes === null || bytes === 0) return '-';
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

const pluralPages = (count: number) => (count === 1 ? 'page' : 'pages');

const columnWidths = (groups: FrameworkGroup[], showSizes: boolean) => {
	const pages = groups.flatMap((group) => group.pages);

	return {
		name: Math.max(...pages.map((page) => page.name.length)),
		size: showSizes
			? Math.max(
					...pages.map((page) => formatSize(page.sizeBytes).length)
				)
			: 0
	};
};

const renderGroupHeader = (group: FrameworkGroup) =>
	`\n${colors.bold}${group.label}${colors.reset}${colors.dim} · ${group.pages.length} ${pluralPages(group.pages.length)}${colors.reset}`;

const renderPageLine = (
	page: PageEntry,
	widths: ColumnWidths,
	showSizes: boolean
) => {
	const name = padLine(page.name, widths.name);
	const size = showSizes
		? `  ${padStart(formatSize(page.sizeBytes), widths.size)}`
		: '';

	return `  ${name}${size}  ${colors.dim}${page.sourcePath}${colors.reset}`;
};

const renderGroup = (
	group: FrameworkGroup,
	widths: ColumnWidths,
	showSizes: boolean
) => [
	renderGroupHeader(group),
	...group.pages.map((page) => renderPageLine(page, widths, showSizes))
];

const renderFooter = (groups: FrameworkGroup[]) => {
	const frameworkCount = groups.length;
	const pageCount = groups.reduce(
		(sum, group) => sum + group.pages.length,
		0
	);

	return `\n${colors.dim}${frameworkCount} ${frameworkCount === 1 ? 'framework' : 'frameworks'} · ${pageCount} ${pluralPages(pageCount)}${colors.reset}`;
};

const printInventory = (
	groups: FrameworkGroup[],
	showSizes: boolean,
	note: string | null
) => {
	const widths = columnWidths(groups, showSizes);
	const header = note === null ? [] : [`${colors.dim}${note}${colors.reset}`];
	const body = groups.flatMap((group) =>
		renderGroup(group, widths, showSizes)
	);
	const lines = [...header, ...body, renderFooter(groups)];
	process.stdout.write(`${lines.join('\n')}\n`);
};

const emit = (
	groups: FrameworkGroup[],
	showSizes: boolean,
	note: string | null,
	wantsJson: boolean
) => {
	if (wantsJson) {
		process.stdout.write(`${JSON.stringify(groups, null, 2)}\n`);

		return;
	}

	printInventory(groups, showSizes, note);
};

const printDim = (message: string) => {
	process.stdout.write(`${colors.dim}${message}${colors.reset}\n`);
};

const SIZE_UNITS: Record<string, number> = {
	b: 1,
	gb: BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE,
	kb: BYTES_PER_KILOBYTE,
	mb: BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE
};

const parseBudget = (args: string[]) => {
	const value = parseFlagValue(args, '--budget');
	if (value === undefined) return null;
	const match = value.toLowerCase().match(/^([\d.]+)\s*(gb|mb|kb|b)?$/);
	const amount = match ? Number(match[1]) : NaN;
	if (!Number.isFinite(amount)) return null;

	return amount * (SIZE_UNITS[match?.[2] ?? 'b'] ?? 1);
};

const reportBudget = (groups: FrameworkGroup[], budget: number) => {
	const over = groups
		.flatMap((group) => group.pages)
		.filter((page) => (page.sizeBytes ?? 0) > budget);
	if (over.length === 0) {
		printDim(`✓ all pages within ${formatSize(budget)} budget`);

		return;
	}
	over.forEach((page) =>
		process.stdout.write(
			`  ${colors.red}✗ ${page.name} ${formatSize(page.sizeBytes)} > ${formatSize(budget)}${colors.reset}\n`
		)
	);
	printDim(`${over.length} page${over.length === 1 ? '' : 's'} over budget`);
	process.exitCode = 1;
};

const guardBrokenPipe = () => {
	// `absolute ls | head` closes the reader early, surfacing as an async EPIPE
	// on stdout. Exit cleanly instead of crashing with a stack trace.
	process.stdout.on('error', (error) => {
		if (
			error instanceof Error &&
			'code' in error &&
			error.code === 'EPIPE'
		) {
			process.exit(0);
		}
	});
};

export const runLs = async (args: string[]) => {
	guardBrokenPipe();

	const raw = await loadRawConfigSafe(parseFlagValue(args, '--config'));
	if (!raw) {
		printDim(
			'Could not load absolute.config.ts — run `absolute ls` from your project root.'
		);

		return;
	}

	const candidates = configCandidates(raw);
	const specs = candidates.flatMap((candidate) =>
		specsFor(candidate.source, candidate.baseDir)
	);
	const scanned = (await Promise.all(specs.map(scanFramework))).flatMap(
		(group) => (group ? [group] : [])
	);
	const groups = mergeByLabel(scanned);
	if (groups.length === 0) {
		printDim(
			'No pages found. Check the framework directories in absolute.config.ts.'
		);

		return;
	}

	const wantsJson = args.includes('--json');
	if (!args.includes('--sizes')) {
		emit(groups, false, null, wantsJson);

		return;
	}

	const sizesDir = resolveSizesDir(args, candidates);
	const manifestPath = join(sizesDir, 'manifest.json');
	if (!existsSync(manifestPath)) {
		printDim(
			`No build at ${relativeOrSelf(manifestPath)}. Run \`absolute build\` first, or pass \`--outdir <dir>\`.`
		);

		return;
	}

	const sized = withSizes(groups, pageSizer(readManifestSizes(sizesDir)));
	const note = `${relativeOrSelf(manifestPath)} · built ${manifestAge(manifestPath)} ago`;
	emit(sized, true, note, wantsJson);

	const budget = parseBudget(args);
	if (budget !== null && !wantsJson) reportBudget(sized, budget);
};
