import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '../../utils/loadConfig';
import { formatBytes } from '../../utils/formatBytes';
import { colors, padLine } from '../tuiPrimitives';

const BASELINE_FILE = '.absolute-size-baseline.json';
const TOP_CHANGES = 12;
const CATEGORY_WIDTH = 16;
const SIZE_WIDTH = 12;
const CHANGE_WIDTH = 10;

const CATEGORY_ORDER = [
	'Pages',
	'Hydration',
	'Client',
	'Islands',
	'Shared chunks',
	'CSS'
];

const categoryOf = (key: string) => {
	if (key.startsWith('Island')) return 'Islands';
	if (key.startsWith('Chunk')) return 'Shared chunks';
	if (key.endsWith('CSS')) return 'CSS';
	if (key.endsWith('Index')) return 'Hydration';
	if (key.endsWith('Client')) return 'Client';

	return 'Pages';
};

const fileSize = (path: string) => {
	try {
		return statSync(path).size;
	} catch {
		return 0;
	}
};

const readSizes = (manifestDir: string) => {
	const manifestPath = join(manifestDir, 'manifest.json');
	if (!existsSync(manifestPath)) return null;
	const manifest: Record<string, string> = JSON.parse(
		readFileSync(manifestPath, 'utf-8')
	);
	const sizes: Record<string, number> = {};
	for (const [key, value] of Object.entries(manifest)) {
		sizes[key] = fileSize(join(manifestDir, value.replace(/^\//, '')));
	}

	return sizes;
};

const readBaseline = (cwd: string) => {
	const path = join(cwd, BASELINE_FILE);
	if (!existsSync(path)) return null;
	try {
		const parsed: Record<string, number> = JSON.parse(
			readFileSync(path, 'utf-8')
		);

		return parsed;
	} catch {
		return null;
	}
};

const signedBytes = (value: number) => {
	if (value > 0) return `+${formatBytes(value)}`;
	if (value < 0) return `-${formatBytes(-value)}`;

	return '—';
};

const deltaColor = (value: number) => {
	if (value > 0) return colors.red;
	if (value < 0) return colors.green;

	return colors.dim;
};

const categoryTotals = (sizes: Record<string, number>) => {
	const totals = new Map<string, number>(
		CATEGORY_ORDER.map((category) => [category, 0])
	);
	for (const [key, size] of Object.entries(sizes)) {
		const category = categoryOf(key);
		totals.set(category, (totals.get(category) ?? 0) + size);
	}

	return totals;
};

const deltaFor = (
	category: string,
	sizes: Record<string, number>,
	baseline: Record<string, number> | null
) => {
	if (!baseline) return null;
	const keys = new Set([...Object.keys(sizes), ...Object.keys(baseline)]);
	let delta = 0;
	for (const key of keys) {
		if (categoryOf(key) !== category) continue;
		delta += (sizes[key] ?? 0) - (baseline[key] ?? 0);
	}

	return delta;
};

const biggestChanges = (
	sizes: Record<string, number>,
	baseline: Record<string, number>
) => {
	const keys = new Set([...Object.keys(sizes), ...Object.keys(baseline)]);

	return [...keys]
		.map((key) => ({
			delta: (sizes[key] ?? 0) - (baseline[key] ?? 0),
			key
		}))
		.filter((entry) => entry.delta !== 0)
		.sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
		.slice(0, TOP_CHANGES);
};

const changeLines = (
	sizes: Record<string, number>,
	baseline: Record<string, number>
) => {
	const changes = biggestChanges(sizes, baseline);
	if (changes.length === 0) return [];

	return [
		`\n  ${colors.dim}Biggest changes${colors.reset}`,
		...changes.map(
			(change) =>
				`    ${deltaColor(change.delta)}${padLine(signedBytes(change.delta), CHANGE_WIDTH)}${colors.reset}${change.key}`
		)
	];
};

const renderRow = (label: string, size: number, delta: number | null) => {
	const deltaText =
		delta === null
			? ''
			: `  ${deltaColor(delta)}${signedBytes(delta)}${colors.reset}`;

	return `  ${padLine(label, CATEGORY_WIDTH)}${colors.dim}${padLine(formatBytes(size), SIZE_WIDTH)}${colors.reset}${deltaText}`;
};

const printReport = (
	sizes: Record<string, number>,
	baseline: Record<string, number> | null
) => {
	const totals = categoryTotals(sizes);
	const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
	const lines = CATEGORY_ORDER.filter(
		(category) => (totals.get(category) ?? 0) > 0
	).map((category) =>
		renderRow(
			category,
			totals.get(category) ?? 0,
			deltaFor(category, sizes, baseline)
		)
	);
	const totalDelta = baseline
		? Object.keys({ ...sizes, ...baseline }).reduce(
				(sum, key) => sum + ((sizes[key] ?? 0) - (baseline[key] ?? 0)),
				0
			)
		: null;
	const parts = [
		lines.join('\n'),
		`  ${colors.dim}${'─'.repeat(CATEGORY_WIDTH + SIZE_WIDTH)}${colors.reset}`,
		renderRow('Total', total, totalDelta)
	];
	if (baseline) parts.push(...changeLines(sizes, baseline));
	const footer = baseline
		? `${colors.dim}vs baseline ${BASELINE_FILE} · run \`absolute analyze --save\` to update${colors.reset}`
		: `${colors.dim}no baseline yet — run \`absolute analyze --save\` to record one${colors.reset}`;
	process.stdout.write(`${parts.join('\n')}\n\n  ${footer}\n`);
};

export const runAnalyze = async (args: string[]) => {
	const cwd = process.cwd();
	const configIndex = args.indexOf('--config');
	const config = await loadConfig(
		configIndex >= 0 ? args[configIndex + 1] : undefined
	);
	const outdirIndex = args.indexOf('--outdir');
	const outdir =
		outdirIndex >= 0 ? args[outdirIndex + 1] : config.buildDirectory;
	const sizes = readSizes(resolve(cwd, outdir ?? 'build'));
	if (sizes === null) {
		process.stdout.write(
			`${colors.dim}No build found. Run \`absolute build\` first.${colors.reset}\n`
		);

		return;
	}

	if (args.includes('--save')) {
		writeFileSync(
			join(cwd, BASELINE_FILE),
			`${JSON.stringify(sizes, null, 2)}\n`
		);
		process.stdout.write(
			`${colors.green}✓${colors.reset} Saved size baseline (${Object.keys(sizes).length} entries) to ${BASELINE_FILE}\n`
		);

		return;
	}

	if (args.includes('--json')) {
		process.stdout.write(`${JSON.stringify(sizes, null, 2)}\n`);

		return;
	}

	printReport(sizes, readBaseline(cwd));
};
