import { freemem, totalmem } from 'node:os';
import { LIST_TUI_COLUMN_GAP } from '../../constants';
import { formatBytes } from '../../utils/formatBytes';
import { discoverInstances } from '../discoverInstances';
import { enrichInstances } from '../instanceStatus';
import { colors, padLine, visibleLength } from '../tuiPrimitives';
import type { LiveInstance } from '../../../types/cli';

const BAR_WIDTH = 12;
const PERCENT = 100;
const HEADERS = ['NAME', 'SOURCE', 'PORT', 'RSS', '% SYS'];

const sumMemory = (instances: LiveInstance[]) =>
	instances.reduce(
		(total, instance) => total + (instance.memoryBytes ?? 0),
		0
	);

const memBar = (fraction: number) => {
	const filled = Math.max(
		0,
		Math.min(BAR_WIDTH, Math.round(fraction * BAR_WIDTH))
	);

	return `${'█'.repeat(filled)}${colors.dim}${'░'.repeat(BAR_WIDTH - filled)}${colors.reset}`;
};

const instanceCells = (instance: LiveInstance, systemTotal: number) => {
	const rss = instance.memoryBytes ?? 0;
	const fraction = systemTotal > 0 ? rss / systemTotal : 0;

	return [
		instance.name,
		instance.source,
		instance.port === null ? '-' : String(instance.port),
		formatBytes(instance.memoryBytes),
		`${memBar(fraction)} ${(fraction * PERCENT).toFixed(1)}%`
	];
};

const columnWidths = (rows: string[][]) =>
	HEADERS.map((header, index) =>
		Math.max(
			visibleLength(header),
			...rows.map((cells) => visibleLength(cells[index] ?? ''))
		)
	);

const renderRow = (cells: string[], widths: number[]) =>
	cells
		.map((cell, index) => padLine(cell, widths[index] ?? 0))
		.join(' '.repeat(LIST_TUI_COLUMN_GAP));

const printReport = (instances: LiveInstance[]) => {
	const systemTotal = totalmem();
	const used = systemTotal - freemem();
	const rows = instances.map((instance) =>
		instanceCells(instance, systemTotal)
	);
	const widths = columnWidths(rows);
	const count = instances.length;
	const lines = [
		`${colors.dim}${renderRow(HEADERS, widths)}${colors.reset}`,
		...rows.map((cells) => renderRow(cells, widths)),
		'',
		`${colors.dim}${count} server${count === 1 ? '' : 's'} · ${formatBytes(sumMemory(instances))} resident total${colors.reset}`,
		`${colors.dim}system  ${formatBytes(used)} / ${formatBytes(systemTotal)} used · ${formatBytes(freemem())} free${colors.reset}`
	];
	process.stdout.write(`${lines.join('\n')}\n`);
};

export const runMem = async (args: string[]) => {
	if (args[0] === 'diff') {
		const { runHeapDiff } = await import('../heapDiff');
		runHeapDiff(args[1], args[2]);

		return;
	}

	const instances = (await enrichInstances(await discoverInstances())).sort(
		(left, right) => (right.memoryBytes ?? 0) - (left.memoryBytes ?? 0)
	);

	if (args.includes('--json')) {
		process.stdout.write(
			`${JSON.stringify(
				{
					instances,
					system: {
						freeBytes: freemem(),
						totalBytes: totalmem(),
						usedBytes: totalmem() - freemem()
					}
				},
				null,
				2
			)}\n`
		);

		return;
	}

	if (instances.length === 0) {
		process.stdout.write(
			`${colors.dim}No running servers found.${colors.reset}\n`
		);

		return;
	}

	printReport(instances);
};
