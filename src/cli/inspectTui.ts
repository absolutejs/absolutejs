import {
	LIST_TUI_DEFAULT_HEIGHT,
	LIST_TUI_DEFAULT_WIDTH,
	LIST_WATCH_REFRESH_MS,
	UNFOUND_INDEX
} from '../constants';
import {
	aggregates,
	fetchRequests,
	findServer,
	formatRequestRow,
	pathColumnWidth,
	requestDetail,
	requestHeader
} from './inspectData';
import {
	ESCAPE,
	colors,
	formatTimestamp,
	openTtyStream,
	padLine,
	stripAnsi,
	truncateText,
	visibleLength
} from './tuiPrimitives';
import type { RequestRecord, TuiInput } from '../../types/cli';

const CHROME_LINES = 6;
const MIN_LIST_HEIGHT = 3;

const driveInspectTui = async (terminal: TuiInput) => {
	const { promise, resolve: resolveExit } = Promise.withResolvers<void>();
	let records: RequestRecord[] = [];
	let serverName: string | null = null;
	// `at` of the pinned row; null = follow the newest request.
	let selectedAt: number | null = null;
	let disposed = false;
	let refreshTimer: NodeJS.Timeout | null = null;
	let escapeBuffer = '';

	const selectedIndex = () => {
		if (records.length === 0) return UNFOUND_INDEX;
		if (selectedAt === null) return records.length - 1;
		const found = records.findIndex((record) => record.at === selectedAt);

		return found >= 0 ? found : records.length - 1;
	};

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

	const listRows = (width: number, height: number, selected: number) => {
		const pathWidth = pathColumnWidth(width);
		const rows = [padLine(`  ${requestHeader(pathWidth)}`, width)];
		const bodyHeight = height - 1;
		const start = Math.max(
			0,
			Math.min(records.length - bodyHeight, selected - bodyHeight + 1)
		);
		const visible = records.slice(start, start + bodyHeight);
		visible.forEach((record, index) => {
			const isSelected = start + index === selected;
			const marker = isSelected
				? `${colors.cyan}❯${colors.reset} `
				: '  ';
			rows.push(
				padLine(
					`${marker}${formatRequestRow(record, pathWidth)}`,
					width
				)
			);
		});
		for (let index = visible.length; index < bodyHeight; index += 1) {
			rows.push(' '.repeat(width));
		}

		return rows;
	};

	const fitLine = (line: string, width: number) =>
		visibleLength(line) <= width
			? padLine(line, width)
			: padLine(truncateText(stripAnsi(line), width), width);

	const detailRows = (width: number, height: number, selected: number) => {
		const record = records[selected];
		const content = record
			? requestDetail(record)
			: [`${colors.dim}No request selected.${colors.reset}`];
		const rows = content
			.slice(0, height)
			.map((line) => fitLine(line, width));
		for (let index = rows.length; index < height; index += 1) {
			rows.push(' '.repeat(width));
		}

		return rows;
	};

	const render = () => {
		if (disposed) return;

		const width = process.stdout.columns ?? LIST_TUI_DEFAULT_WIDTH;
		const height = process.stdout.rows ?? LIST_TUI_DEFAULT_HEIGHT;
		const selected = selectedIndex();
		const available = Math.max(MIN_LIST_HEIGHT * 2, height - CHROME_LINES);
		const listHeight = Math.max(MIN_LIST_HEIGHT, Math.ceil(available / 2));
		const detailHeight = Math.max(MIN_LIST_HEIGHT, available - listHeight);
		const { avgMs, count, p95Ms } = aggregates(records);
		const rows = [
			padLine(titleLine(width), width),
			divider(width),
			...listRows(width, listHeight, selected),
			divider(width),
			...detailRows(width, detailHeight, selected),
			divider(width),
			padLine(
				`${colors.dim}${count} requests · ${avgMs}ms avg · ${p95Ms}ms p95 · ↑↓ select · q quit${colors.reset}`,
				width
			)
		];
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

	const move = (delta: number) => {
		if (records.length === 0) return;
		const next = Math.max(
			0,
			Math.min(records.length - 1, selectedIndex() + delta)
		);
		selectedAt =
			next === records.length - 1 ? null : (records[next]?.at ?? null);
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

	const handleEscapeSequence = (char: string) => {
		escapeBuffer += char;
		if (escapeBuffer === `${ESCAPE}[A`) {
			escapeBuffer = '';
			move(UNFOUND_INDEX);

			return;
		}
		if (escapeBuffer === `${ESCAPE}[B`) {
			escapeBuffer = '';
			move(1);

			return;
		}
		// Keep buffering only the partial CSI prefixes; drop anything else.
		if (escapeBuffer !== ESCAPE && escapeBuffer !== `${ESCAPE}[`) {
			escapeBuffer = '';
		}
	};

	const handleChar = (char: string) => {
		if (char === 'q' || char === '\x03') {
			quit();

			return;
		}
		if (escapeBuffer || char === ESCAPE) {
			handleEscapeSequence(char);

			return;
		}
		if (char === 'k') move(UNFOUND_INDEX);
		if (char === 'j') move(1);
	};

	const onData = (chunk: Buffer) => {
		for (const char of chunk.toString()) handleChar(char);
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
