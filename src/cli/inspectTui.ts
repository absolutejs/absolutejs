import {
	LIST_TUI_DEFAULT_HEIGHT,
	LIST_TUI_DEFAULT_WIDTH,
	LIST_WATCH_REFRESH_MS
} from '../constants';
import {
	aggregates,
	fetchRequests,
	findServer,
	formatRequestRow,
	pathColumnWidth,
	requestHeader
} from './inspectData';
import {
	colors,
	formatTimestamp,
	openTtyStream,
	padLine,
	visibleLength
} from './tuiPrimitives';
import type { RequestRecord, TuiInput } from '../../types/cli';

const HEADER_LINES = 3;
const FOOTER_LINES = 2;

const driveInspectTui = async (terminal: TuiInput) => {
	const { promise, resolve: resolveExit } = Promise.withResolvers<void>();
	let records: RequestRecord[] = [];
	let serverName: string | null = null;
	let disposed = false;
	let refreshTimer: NodeJS.Timeout | null = null;

	const divider = (width: number) =>
		`${colors.dim}${'─'.repeat(Math.max(width, 1))}${colors.reset}`;

	const titleLine = (width: number) => {
		const name = serverName
			? `  ${colors.bold}${serverName}${colors.reset}`
			: '';
		const left = `${colors.cyan}${colors.bold}ABSOLUTEJS${colors.reset} ${colors.dim}request inspector${colors.reset}${name}`;
		const right = `${colors.dim}${formatTimestamp()}${colors.reset}`;
		const gap = Math.max(
			1,
			width - visibleLength(left) - visibleLength(right)
		);

		return `${left}${' '.repeat(gap)}${right}`;
	};

	const emptyMessage = () =>
		serverName === null
			? `  ${colors.dim}No running dev server — start one with \`absolute dev\`.${colors.reset}`
			: `  ${colors.dim}No requests yet — hit your app to see them here.${colors.reset}`;

	const render = () => {
		if (disposed) return;

		const width = process.stdout.columns ?? LIST_TUI_DEFAULT_WIDTH;
		const height = process.stdout.rows ?? LIST_TUI_DEFAULT_HEIGHT;
		const pathWidth = pathColumnWidth(width);
		const bodyHeight = Math.max(1, height - HEADER_LINES - FOOTER_LINES);
		const visible = records.slice(-bodyHeight);
		const rows = [
			padLine(titleLine(width), width),
			divider(width),
			padLine(`  ${requestHeader(pathWidth)}`, width)
		];
		if (visible.length === 0) rows.push(padLine(emptyMessage(), width));
		for (const record of visible) {
			rows.push(
				padLine(`  ${formatRequestRow(record, pathWidth)}`, width)
			);
		}
		for (let index = visible.length; index < bodyHeight; index += 1) {
			rows.push(' '.repeat(width));
		}
		rows.push(divider(width));
		const { avgMs, count, p95Ms } = aggregates(records);
		rows.push(
			padLine(
				`${colors.dim}${count} requests · ${avgMs}ms avg · ${p95Ms}ms p95 · live · q quit${colors.reset}`,
				width
			)
		);
		const screen = rows
			.slice(0, height)
			.map((line) => `\x1b[2K${line}`)
			.join('\n');
		process.stdout.write(`\x1b[H${screen}\x1b[?25l`);
	};

	const refresh = async () => {
		const server = await findServer();
		if (!server || server.url === null) {
			serverName = null;
			records = [];
			render();

			return;
		}
		serverName = server.name;
		const fetched = await fetchRequests(server.url);
		if (fetched) records = fetched;
		render();
	};

	const dispose = () => {
		if (disposed) return;

		disposed = true;
		if (refreshTimer) clearInterval(refreshTimer);
		process.stdout.off('resize', render);
		terminal.off('data', onData);
		if (terminal.setRawMode) terminal.setRawMode(false);
		terminal.pause();
		if (terminal !== process.stdin) terminal.destroy();
		process.stdout.write('\x1b[?25h\x1b[?1049l');
	};

	const quit = () => {
		process.off('SIGINT', quit);
		process.off('SIGTERM', quit);
		dispose();
		resolveExit();
	};

	const onData = (chunk: Buffer) => {
		for (const char of chunk.toString()) {
			if (char === 'q' || char === '\x03') quit();
		}
	};

	process.on('SIGINT', quit);
	process.on('SIGTERM', quit);
	process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l');
	terminal.resume();
	terminal.on('data', onData);
	process.stdout.on('resize', render);
	refreshTimer = setInterval(() => {
		void refresh();
	}, LIST_WATCH_REFRESH_MS);
	await refresh();
	await promise;
};

export const runInspectTui = async () => {
	const input = openTtyStream();
	if (!input) {
		process.stdout.write(
			'Interactive inspect requires a TTY. Run `absolute inspect --json` instead.\n'
		);

		return;
	}

	await driveInspectTui(input);
};
