import { LIST_TUI_COLUMN_GAP } from '../../constants';
import { getDurationString } from '../../utils/getDurationString';
import { discoverInstances } from '../discoverInstances';
import { enrichInstances } from '../instanceStatus';
import { colors, padLine, visibleLength } from '../tuiPrimitives';
import type { InstanceStatus, LiveInstance } from '../../../types/cli';

const killPid = (pid: number) => {
	try {
		process.kill(pid, 'SIGTERM');

		return true;
	} catch {
		return false;
	}
};

const TABLE_HEADERS = [
	'NAME',
	'SOURCE',
	'PORT',
	'PID',
	'UPTIME',
	'STATUS',
	'URL'
];

const statusColor = (status: InstanceStatus) => {
	if (status === 'ready') return colors.green;
	if (status === 'starting') return colors.yellow;

	return colors.dim;
};

const instanceCells = (instance: LiveInstance) => [
	instance.name,
	instance.source,
	instance.port === null ? '-' : String(instance.port),
	String(instance.pid),
	getDurationString(instance.uptimeMs),
	`${statusColor(instance.status)}${instance.status}${colors.reset}`,
	instance.url ?? '-'
];

const columnWidths = (rows: string[][]) =>
	TABLE_HEADERS.map((header, index) =>
		Math.max(
			visibleLength(header),
			...rows.map((cells) => visibleLength(cells[index] ?? ''))
		)
	);

const renderRow = (cells: string[], widths: number[]) =>
	cells
		.map((cell, index) => padLine(cell, widths[index] ?? 0))
		.join(' '.repeat(LIST_TUI_COLUMN_GAP));

const printInstanceTable = (instances: LiveInstance[]) => {
	if (instances.length === 0) {
		process.stdout.write(
			`${colors.dim}No AbsoluteJS servers are running. Start one with \`absolute dev\`.${colors.reset}\n`
		);

		return;
	}

	const rows = instances.map(instanceCells);
	const widths = columnWidths(rows);

	process.stdout.write(
		`${colors.dim}${renderRow(TABLE_HEADERS, widths)}${colors.reset}\n`
	);
	for (const cells of rows) {
		process.stdout.write(`${renderRow(cells, widths)}\n`);
	}
};

export const runPs = async (args: string[]) => {
	// `absolute ps | head` closes the reader early, which surfaces as an async
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

	if (args.includes('--watch') || args.includes('-w')) {
		const { runPsTui } = await import('../psTui');
		await runPsTui();

		return;
	}

	const instances = await enrichInstances(await discoverInstances());

	if (args.includes('--kill-all')) {
		const killed = instances.filter((instance) => killPid(instance.pid));
		process.stdout.write(
			`${colors.dim}Killed ${killed.length} server${killed.length === 1 ? '' : 's'}.${colors.reset}\n`
		);

		return;
	}

	if (args.includes('--kill')) {
		const value = args[args.indexOf('--kill') + 1];
		const target = Number(value);
		const match = instances.find(
			(instance) => instance.pid === target || instance.port === target
		);
		const pid = match?.pid ?? target;
		const killed = Number.isInteger(pid) && killPid(pid);
		const label = match
			? `${match.name} (pid ${pid}${match.port === null ? '' : `, port ${match.port}`})`
			: `pid ${pid}`;
		process.stdout.write(
			`${colors.dim}${killed ? `Killed ${label}` : `No server found for \`--kill ${value ?? ''}\``}.${colors.reset}\n`
		);

		return;
	}

	if (args.includes('--json')) {
		process.stdout.write(`${JSON.stringify(instances, null, 2)}\n`);

		return;
	}

	printInstanceTable(instances);
};
