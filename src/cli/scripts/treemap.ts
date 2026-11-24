/* The module-level half of `absolute analyze`: what a bundle is made OF,
 * rather than how big it is.
 *
 * Needs sourcemaps, and says so rather than reporting an empty breakdown:
 * a project builds without them by default, so "no modules found" would
 * read as "your bundle contains nothing" instead of "turn this on". */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { formatBytes } from '../../utils/formatBytes';
import { colors, padLine } from '../tuiPrimitives';
import { attributeBytes, groupModules, type ModuleSize } from './moduleSizes';

const GROUP_WIDTH = 34;
const SIZE_WIDTH = 10;
const BAR_WIDTH = 24;
const TOP_GROUPS = 20;
const TREEMAP_WIDTH = 1000;
const TREEMAP_HEIGHT = 620;
const MIN_LABEL_AREA = 2600;

type BundleReport = {
	file: string;
	modules: ModuleSize[];
	total: number;
	unmapped: number;
};

const jsFilesUnder = (directory: string): string[] => {
	const entries = readdirSync(directory, { withFileTypes: true });

	return entries.flatMap((entry) => {
		const full = join(directory, entry.name);
		if (entry.isDirectory()) return jsFilesUnder(full);

		return entry.name.endsWith('.js') ? [full] : [];
	});
};

/* Two places, because a production build deliberately moves the maps out
 * of what it serves. With `sourcemaps: 'external'` the build chains each
 * map back to original source, renames it into a private `sourcemaps/`
 * directory keyed by the JS file's BASENAME, and strips the
 * `sourceMappingURL` comment from the shipped JS so source is not
 * exposed. Looking only beside the bundle found 1 of 96 maps here — the
 * server bundle — and reported the client bundles as having none. */
const mapPathFor = (file: string, sourcemapDir: string | undefined) => {
	const sidecar = `${file}.map`;
	if (existsSync(sidecar)) return sidecar;
	if (sourcemapDir === undefined) return undefined;
	const privateMap = join(sourcemapDir, `${basename(file)}.map`);

	return existsSync(privateMap) ? privateMap : undefined;
};

const readMap = (file: string, sourcemapDir: string | undefined) => {
	const sidecar = mapPathFor(file, sourcemapDir);
	if (sidecar === undefined) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(sidecar, 'utf8'));
		const mappings: unknown = Reflect.get(Object(parsed), 'mappings');
		const sources: unknown = Reflect.get(Object(parsed), 'sources');
		if (typeof mappings !== 'string' || !Array.isArray(sources))
			return undefined;

		return { mappings, sources: sources.map((one) => String(one)) };
	} catch {
		/* A truncated or unparseable map is the same as no map here. */
		return undefined;
	}
};

export const bundleFileSize = (file: string) => {
	try {
		return statSync(file).size;
	} catch {
		return 0;
	}
};

const bar = (fraction: number) => {
	const filled = Math.max(1, Math.round(fraction * BAR_WIDTH));

	return `${'█'.repeat(filled)}${colors.dim}${'·'.repeat(BAR_WIDTH - filled)}${colors.reset}`;
};

export const printModuleReport = (
	buildPath: string,
	reports: BundleReport[],
	scanned: number
) => {
	const modules = reports.flatMap((report) => report.modules);
	const groups = groupModules(modules);
	const attributed = modules.reduce((sum, one) => sum + one.bytes, 0);
	const unmapped = reports.reduce((sum, one) => sum + one.unmapped, 0);
	const total = reports.reduce((sum, one) => sum + one.total, 0);
	const largest = groups[0]?.bytes ?? 1;

	process.stdout.write(
		`${colors.dim}${reports.length} of ${scanned} bundles carry a sourcemap · ${formatBytes(total)}${colors.reset}\n\n`
	);
	for (const { bytes, group } of groups.slice(0, TOP_GROUPS)) {
		const share = ((bytes / attributed) * 100).toFixed(1);
		process.stdout.write(
			`  ${padLine(group, GROUP_WIDTH)}  ${padLine(formatBytes(bytes), SIZE_WIDTH)}  ${padLine(`${share}%`, 6)}  ${bar(bytes / largest)}\n`
		);
	}
	const hidden = groups.length - TOP_GROUPS;
	if (hidden > 0)
		process.stdout.write(
			`  ${colors.dim}… ${hidden} more${colors.reset}\n`
		);

	/* Reported, not hidden: a bundler's prelude and the glue between
	 * modules belong to no source file, and leaving them out would make
	 * every percentage above add up to more than the bundle. */
	process.stdout.write(
		`\n${colors.dim}${formatBytes(attributed)} attributed to ${modules.length} modules in ${groups.length} groups · ${formatBytes(unmapped)} unmapped (bundler glue)${colors.reset}\n`
	);
};

/** Every bundle under the build directory that carries a sourcemap, with
 *  its bytes attributed to the modules that produced them. */
export const readBundleReports = (buildPath: string, sourcemapDir?: string) => {
	const files = existsSync(buildPath) ? jsFilesUnder(buildPath) : [];
	const withMaps = files.flatMap((file) => {
		const map = readMap(file, sourcemapDir);
		if (map === undefined) return [];
		const generated = readFileSync(file, 'utf8');
		const attributed = attributeBytes(generated, map);
		const report: BundleReport = {
			file,
			modules: attributed.modules,
			total: attributed.total,
			unmapped: attributed.unmapped
		};

		return [report];
	});

	return { bundles: withMaps, scanned: files.length };
};

/* Squarified treemap: lay each row across the shorter side so the
 * rectangles stay close to square, which is what makes a treemap
 * readable at a glance rather than a row of slivers. */
type Rect = {
	bytes: number;
	group: string;
	height: number;
	width: number;
	x: number;
	y: number;
};

type Box = { height: number; width: number; x: number; y: number };

type GroupSize = { bytes: number; group: string };

const worstRatio = (row: number[], side: number, scale: number) => {
	const sum = row.reduce((left, right) => left + right, 0);
	const length = (sum * scale) / side;

	return row.reduce((worst, value) => {
		const other = (value * scale) / length;

		return Math.max(worst, length / other, other / length);
	}, 0);
};

const layoutRow = (row: GroupSize[], box: Box, scale: number) => {
	const sum = row.reduce((total, one) => total + one.bytes, 0);
	const horizontal = box.width <= box.height;
	const depth = (sum * scale) / (horizontal ? box.width : box.height);
	let offset = 0;
	const rects = row.map(({ bytes, group }) => {
		const span = (bytes * scale) / depth;
		const rect: Rect = horizontal
			? {
					bytes,
					group,
					height: depth,
					width: span,
					x: box.x + offset,
					y: box.y
				}
			: {
					bytes,
					group,
					height: span,
					width: depth,
					x: box.x,
					y: box.y + offset
				};
		offset += span;

		return rect;
	});
	const remaining: Box = horizontal
		? {
				height: box.height - depth,
				width: box.width,
				x: box.x,
				y: box.y + depth
			}
		: {
				height: box.height,
				width: box.width - depth,
				x: box.x + depth,
				y: box.y
			};

	return { rects, remaining };
};

/** The line printed when a build has no sourcemaps: the one case where an
 *  empty report is a configuration answer rather than a measurement. */
export const sourcemapHint = (buildPath: string, scanned: number) =>
	`${colors.dim}None of the ${scanned} bundles under ${relative(process.cwd(), buildPath) || '.'} carry a sourcemap, so there is nothing to attribute.${colors.reset}\n` +
	`Set ${colors.green}sourcemaps: 'external'${colors.reset} in absolute.config.ts and build again.\n`;

/* As many groups as keep the row's rectangles closest to square: adding
 * one more helps until it makes the worst aspect ratio worse, which is
 * the squarified treemap rule. */
const takeRow = (
	groups: GroupSize[],
	start: number,
	box: Box,
	scale: number
) => {
	const side = Math.min(box.width, box.height);
	const row: GroupSize[] = [];
	let ratio = Number.POSITIVE_INFINITY;
	for (const candidate of groups.slice(start)) {
		const next = worstRatio(
			[...row, candidate].map((one) => one.bytes),
			side,
			scale
		);
		if (row.length > 0 && next > ratio) break;
		row.push(candidate);
		ratio = next;
	}

	return row;
};

export const squarify = (groups: GroupSize[], box: Box) => {
	const total = groups.reduce((sum, one) => sum + one.bytes, 0);
	if (total === 0 || groups.length === 0) return [];
	const scale = (box.width * box.height) / total;
	const rects: Rect[] = [];
	let remaining = box;
	let index = 0;
	while (index < groups.length) {
		const row = takeRow(groups, index, remaining, scale);
		index += row.length;
		const { rects: laid, remaining: left } = layoutRow(
			row,
			remaining,
			scale
		);
		rects.push(...laid);
		remaining = left;
	}

	return rects;
};

const escapeText = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');

/** A self-contained SVG treemap. No dependency and no CDN: it has to open
 *  from a file:// path in a browser with no network, which is where a
 *  build artifact is looked at. */
export const treemapHtml = (groups: GroupSize[], title: string) => {
	const rects = squarify(groups, {
		height: TREEMAP_HEIGHT,
		width: TREEMAP_WIDTH,
		x: 0,
		y: 0
	});
	const total = groups.reduce((sum, one) => sum + one.bytes, 0);
	const cells = rects
		.map((rect, index) => {
			const hue = (index * 47) % 360;
			const area = rect.width * rect.height;
			const label =
				area < MIN_LABEL_AREA
					? ''
					: `<text x="${(rect.x + 6).toFixed(1)}" y="${(rect.y + 18).toFixed(1)}" fill="#0b1020" font-size="12" font-family="ui-monospace, monospace">${escapeText(rect.group)}</text><text x="${(rect.x + 6).toFixed(1)}" y="${(rect.y + 33).toFixed(1)}" fill="#0b1020" font-size="11" font-family="ui-monospace, monospace" opacity="0.7">${formatBytes(rect.bytes)}</text>`;

			return `<g><title>${escapeText(rect.group)} — ${formatBytes(rect.bytes)} (${((rect.bytes / total) * 100).toFixed(1)}%)</title><rect x="${rect.x.toFixed(1)}" y="${rect.y.toFixed(1)}" width="${Math.max(0, rect.width - 1).toFixed(1)}" height="${Math.max(0, rect.height - 1).toFixed(1)}" fill="hsl(${hue} 68% 72%)" stroke="#0b1020" stroke-width="0.5"/>${label}</g>`;
		})
		.join('');

	return `<!doctype html>
<meta charset="utf-8">
<title>${escapeText(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px; font: 14px ui-monospace, monospace; background: #f6f7fb; color: #0b1020; }
  @media (prefers-color-scheme: dark) { body { background: #0b1020; color: #e8ecff; } }
  h1 { font-size: 16px; margin: 0 0 4px; }
  p { margin: 0 0 16px; opacity: 0.7; }
  svg { width: 100%; height: auto; max-width: ${TREEMAP_WIDTH}px; }
</style>
<h1>${escapeText(title)}</h1>
<p>${formatBytes(total)} across ${groups.length} groups · hover a cell for its exact size</p>
<svg viewBox="0 0 ${TREEMAP_WIDTH} ${TREEMAP_HEIGHT}" role="img" aria-label="Bundle treemap">${cells}</svg>
`;
};
