import { spawn } from 'node:child_process';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import {
	EXCLUDE_LAST_OFFSET,
	LIST_LOG_TAIL_MAX_BYTES,
	LIST_TUI_COLUMN_GAP,
	LIST_TUI_DEFAULT_HEIGHT,
	LIST_TUI_DEFAULT_WIDTH,
	LIST_TUI_ESCAPE_SEQUENCE_TIMEOUT_MS,
	LIST_TUI_FOOTER_LINE_COUNT,
	LIST_TUI_MARKER_WIDTH,
	LIST_TUI_MIN_LOG_HEIGHT,
	LIST_TUI_MIN_URL_WIDTH,
	LIST_TUI_RENDER_DEBOUNCE_MS,
	LIST_TUI_STATUS_MESSAGE_TIMEOUT_MS,
	LIST_WATCH_REFRESH_MS,
	UNFOUND_INDEX
} from '../constants';
import { getDurationString } from '../utils/getDurationString';
import { discoverInstances } from './discoverInstances';
import { enrichInstances } from './instanceStatus';
import {
	ESCAPE,
	colors,
	formatTimestamp,
	isPartialEscapeSequence,
	openTtyStream,
	padLine,
	stripAnsi,
	truncateText,
	visibleLength
} from './tuiPrimitives';
import { killStaleProcesses, openUrlInBrowser } from './utils';
import type { InstanceStatus, LiveInstance, TuiInput } from '../../types/cli';

type ListStatusLevel = 'error' | 'info' | 'success' | 'warn';
type ListStatusMessage = { level: ListStatusLevel; text: string };
type ListMode = 'confirm' | 'list' | 'port';
type ScrollDirection = 'down' | 'pageDown' | 'pageUp' | 'up';

const TUI_HEADERS = [
	'NAME',
	'SOURCE',
	'PORT',
	'PID',
	'UPTIME',
	'STATUS',
	'URL'
];
const STATUS_INDEX = 5;
const URL_INDEX = 6;

const helpLines = [
	'Hotkeys',
	'  ↑/↓ or j/k   Select a server',
	'  s            Stop the selected server',
	'  r            Restart the selected server',
	'  o            Open the selected server in the browser',
	'  f            Free a port (kill whatever is listening on it)',
	'  x            Stop every listed server',
	'  PgUp/PgDn    Scroll the log pane',
	'  ? or h       Toggle this help',
	'  q            Quit (servers keep running)'
];

const statusLevelColor = (level: ListStatusLevel) => {
	if (level === 'error') return colors.red;
	if (level === 'warn') return colors.yellow;
	if (level === 'success') return colors.green;

	return colors.cyan;
};

const statusColor = (status: InstanceStatus) => {
	if (status === 'ready') return colors.green;
	if (status === 'starting') return colors.yellow;

	return colors.dim;
};

const instanceRowCells = (instance: LiveInstance) => [
	instance.name,
	instance.source,
	instance.port === null ? '-' : String(instance.port),
	String(instance.pid),
	getDurationString(instance.uptimeMs),
	instance.status,
	instance.url ?? '-'
];

const columnWidths = (allCells: string[][]) =>
	TUI_HEADERS.map((header, index) =>
		Math.max(
			visibleLength(header),
			...allCells.map((cells) => visibleLength(cells[index] ?? ''))
		)
	);

const layoutWidths = (allCells: string[][], width: number) => {
	const natural = columnWidths(allCells);
	const gaps = (TUI_HEADERS.length - 1) * LIST_TUI_COLUMN_GAP;
	const available = width - LIST_TUI_MARKER_WIDTH - gaps;
	const fixed = natural.reduce(
		(sum, value, index) => (index === URL_INDEX ? sum : sum + value),
		0
	);
	const urlWidth = Math.max(LIST_TUI_MIN_URL_WIDTH, available - fixed);

	return natural.map((value, index) =>
		index === URL_INDEX ? Math.min(value, urlWidth) : value
	);
};

const openReadFd = (path: string) => {
	try {
		return openSync(path, 'r');
	} catch {
		return null;
	}
};

const readLogTail = (path: string | null) => {
	if (!path) return [];

	const descriptor = openReadFd(path);
	if (descriptor === null) return [];

	try {
		const { size } = fstatSync(descriptor);
		const start = Math.max(0, size - LIST_LOG_TAIL_MAX_BYTES);
		const length = size - start;
		const buffer = Buffer.alloc(length);
		readSync(descriptor, buffer, 0, length, start);

		return buffer
			.toString('utf-8')
			.split('\n')
			.filter((line) => line.trim().length > 0);
	} finally {
		closeSync(descriptor);
	}
};

const driveListTui = async (terminal: TuiInput) => {
	const { promise, resolve: resolveExit } = Promise.withResolvers<void>();

	let instances: LiveInstance[] = [];
	let selectedIndex = 0;
	let mode: ListMode = 'list';
	let helpVisible = false;
	let portBuffer = '';
	let statusMessage: ListStatusMessage | null = null;
	let statusTimer: NodeJS.Timeout | null = null;
	let renderTimer: NodeJS.Timeout | null = null;
	let refreshTimer: NodeJS.Timeout | null = null;
	let escapeBuffer = '';
	let escapeTimer: NodeJS.Timeout | null = null;
	let disposed = false;
	let logScrollOffset = 0;
	let lastLogLineCount = 0;
	let lastLogViewportHeight = 0;

	const selectedInstance = () => instances[selectedIndex];

	const scheduleRender = () => {
		if (disposed || renderTimer) return;
		renderTimer = setTimeout(() => {
			renderTimer = null;
			render();
		}, LIST_TUI_RENDER_DEBOUNCE_MS);
	};

	const setStatus = (text: string, level: ListStatusLevel) => {
		statusMessage = { level, text };
		if (statusTimer) clearTimeout(statusTimer);
		statusTimer = setTimeout(() => {
			statusMessage = null;
			scheduleRender();
		}, LIST_TUI_STATUS_MESSAGE_TIMEOUT_MS);
		scheduleRender();
	};

	const refresh = async () => {
		const previousPid = selectedInstance()?.pid;
		instances = await enrichInstances(await discoverInstances());
		const foundIndex =
			previousPid === undefined
				? 0
				: instances.findIndex(
						(instance) => instance.pid === previousPid
					);
		selectedIndex =
			foundIndex >= 0
				? foundIndex
				: Math.min(selectedIndex, Math.max(0, instances.length - 1));
		scheduleRender();
	};

	const signalPid = (pid: number, signal: NodeJS.Signals) => {
		try {
			// Negative pid targets the whole process group so the bun --hot
			// child dies with its `absolute dev` parent.
			process.kill(-pid, signal);

			return;
		} catch {
			/* not a group leader — fall back to the bare pid */
		}
		try {
			process.kill(pid, signal);
		} catch {
			/* already exited */
		}
	};

	const stopSelected = () => {
		const instance = selectedInstance();
		if (!instance) return;

		signalPid(instance.controllerPid, 'SIGTERM');
		const message =
			instance.source === 'workspace'
				? `Stopping ${instance.name}'s workspace (pid ${instance.controllerPid}) — all its services`
				: `Stopped ${instance.name} (pid ${instance.controllerPid})`;
		setStatus(message, 'success');
		void refresh();
	};

	const restartSelected = () => {
		const instance = selectedInstance();
		if (!instance) return;

		if (instance.source === 'workspace') {
			setStatus(
				`${instance.name} is managed by its workspace — restart the workspace itself.`,
				'warn'
			);

			return;
		}
		const [command, ...commandArgs] = instance.command;
		if (!command) {
			setStatus(
				`Cannot restart ${instance.name}: no launch command recorded.`,
				'warn'
			);

			return;
		}
		signalPid(instance.controllerPid, 'SIGTERM');
		const child = spawn(command, commandArgs, {
			cwd: instance.cwd,
			detached: true,
			stdio: 'ignore'
		});
		child.unref();
		setStatus(`Restarting ${instance.name}…`, 'info');
		void refresh();
	};

	const openSelected = () => {
		const instance = selectedInstance();
		if (!instance) return;

		if (!instance.url) {
			setStatus(`${instance.name} has no URL yet.`, 'warn');

			return;
		}
		openUrlInBrowser(instance.url, (message) => setStatus(message, 'warn'));
		setStatus(`Opening ${instance.url}`, 'info');
	};

	const stopAll = () => {
		const count = instances.length;
		instances.forEach((instance) => signalPid(instance.pid, 'SIGTERM'));
		setStatus(
			`Stopped ${count} server${count === 1 ? '' : 's'}.`,
			'success'
		);
		void refresh();
	};

	const freePort = (value: string) => {
		const port = Number(value);
		if (!Number.isInteger(port) || port <= 0) {
			setStatus(`Invalid port: ${value}`, 'error');

			return;
		}
		let killed = false;
		killStaleProcesses(port, (message) => {
			killed = true;
			setStatus(message, 'warn');
		});
		if (!killed) setStatus(`Nothing is listening on port ${port}.`, 'info');
		void refresh();
	};

	const moveSelection = (direction: 'down' | 'up') => {
		if (instances.length === 0) return;

		const delta = direction === 'up' ? UNFOUND_INDEX : 1;
		selectedIndex = Math.max(
			0,
			Math.min(instances.length - 1, selectedIndex + delta)
		);
		logScrollOffset = 0;
		scheduleRender();
	};

	const scrollLogs = (direction: ScrollDirection) => {
		const maxOffset = Math.max(0, lastLogLineCount - lastLogViewportHeight);
		const pageSize = Math.max(1, lastLogViewportHeight - 1);
		if (direction === 'up') {
			logScrollOffset = Math.min(maxOffset, logScrollOffset + 1);
		} else if (direction === 'down') {
			logScrollOffset = Math.max(0, logScrollOffset - 1);
		} else if (direction === 'pageUp') {
			logScrollOffset = Math.min(maxOffset, logScrollOffset + pageSize);
		} else {
			logScrollOffset = Math.max(0, logScrollOffset - pageSize);
		}
		scheduleRender();
	};

	const dispose = () => {
		if (disposed) return;

		disposed = true;
		if (renderTimer) clearTimeout(renderTimer);
		if (statusTimer) clearTimeout(statusTimer);
		if (escapeTimer) clearTimeout(escapeTimer);
		if (refreshTimer) clearInterval(refreshTimer);
		process.stdout.off('resize', onResize);
		terminal.off('data', onData);
		if (terminal.setRawMode) terminal.setRawMode(false);
		if (terminal !== process.stdin) terminal.destroy();
		process.stdout.write('\x1b[?25h\x1b[?1049l');
	};

	const quit = () => {
		dispose();
		resolveExit();
	};

	const listActions = new Map<string, () => void>([
		['f', () => enterPortMode()],
		['h', () => toggleHelp()],
		['j', () => moveSelection('down')],
		['k', () => moveSelection('up')],
		['o', () => openSelected()],
		['q', () => quit()],
		['r', () => restartSelected()],
		['s', () => stopSelected()],
		['x', () => enterConfirmMode()],
		['?', () => toggleHelp()]
	]);

	const toggleHelp = () => {
		helpVisible = !helpVisible;
		scheduleRender();
	};

	const enterPortMode = () => {
		mode = 'port';
		portBuffer = '';
		scheduleRender();
	};

	const enterConfirmMode = () => {
		if (instances.length === 0) return;

		mode = 'confirm';
		scheduleRender();
	};

	const handleListChar = (char: string) => {
		const action = listActions.get(char.toLowerCase());
		if (action) action();
	};

	const handlePortChar = (char: string) => {
		if (char === '\r' || char === '\n') {
			const value = portBuffer;
			mode = 'list';
			portBuffer = '';
			freePort(value);

			return;
		}
		if (char === '\x7f' || char === '\b') {
			portBuffer = portBuffer.slice(0, EXCLUDE_LAST_OFFSET);
			scheduleRender();

			return;
		}
		if (char >= '0' && char <= '9') {
			portBuffer += char;
			scheduleRender();
		}
	};

	const handleConfirmChar = (char: string) => {
		mode = 'list';
		if (char.toLowerCase() === 'y') {
			stopAll();

			return;
		}
		scheduleRender();
	};

	const clearEscapeTimer = () => {
		if (!escapeTimer) return;

		clearTimeout(escapeTimer);
		escapeTimer = null;
	};

	const onBareEscape = () => {
		if (helpVisible) {
			helpVisible = false;
		} else if (mode !== 'list') {
			mode = 'list';
			portBuffer = '';
		}
		scheduleRender();
	};

	const armEscapeTimer = () => {
		clearEscapeTimer();
		escapeTimer = setTimeout(() => {
			escapeTimer = null;
			escapeBuffer = '';
			onBareEscape();
		}, LIST_TUI_ESCAPE_SEQUENCE_TIMEOUT_MS);
	};

	const resetEscape = () => {
		clearEscapeTimer();
		escapeBuffer = '';
	};

	const handleEscapeSequence = (char: string) => {
		escapeBuffer += char;
		if (escapeBuffer === `${ESCAPE}[`) {
			armEscapeTimer();

			return;
		}
		if (escapeBuffer === `${ESCAPE}[A`) {
			resetEscape();
			moveSelection('up');

			return;
		}
		if (escapeBuffer === `${ESCAPE}[B`) {
			resetEscape();
			moveSelection('down');

			return;
		}
		if (escapeBuffer === `${ESCAPE}[5~`) {
			resetEscape();
			scrollLogs('pageUp');

			return;
		}
		if (escapeBuffer === `${ESCAPE}[6~`) {
			resetEscape();
			scrollLogs('pageDown');

			return;
		}
		if (isPartialEscapeSequence(escapeBuffer)) {
			armEscapeTimer();

			return;
		}
		resetEscape();
		onBareEscape();
	};

	const handleChar = (char: string) => {
		if (char === '\x03') {
			quit();

			return;
		}
		if (escapeBuffer) {
			handleEscapeSequence(char);

			return;
		}
		if (char === ESCAPE) {
			escapeBuffer = ESCAPE;
			armEscapeTimer();

			return;
		}
		if (mode === 'port') {
			handlePortChar(char);

			return;
		}
		if (mode === 'confirm') {
			handleConfirmChar(char);

			return;
		}
		handleListChar(char);
	};

	const onData = (chunk: Buffer) => {
		for (const char of chunk.toString()) {
			handleChar(char);
		}
	};

	const onResize = () => {
		scheduleRender();
	};

	const titleLine = (width: number) => {
		const label = `${instances.length} live`;
		const left = `${colors.cyan}${colors.bold}ABSOLUTEJS${colors.reset} ${colors.dim}running servers${colors.reset}  ${colors.bold}${label}${colors.reset}`;
		const right = `${colors.dim}${formatTimestamp()}${colors.reset}`;
		const gap = Math.max(
			1,
			width - visibleLength(left) - visibleLength(right)
		);

		return `${left}${' '.repeat(gap)}${right}`;
	};

	const dividerLine = (width: number) =>
		`${colors.dim}${'─'.repeat(Math.max(width, 1))}${colors.reset}`;

	const colorizeCell = (
		cell: string,
		index: number,
		status: InstanceStatus,
		isSelected: boolean,
		widths: number[]
	) => {
		const padded = padLine(
			truncateText(cell, widths[index] ?? 0),
			widths[index] ?? 0
		);
		if (index === STATUS_INDEX) {
			return `${statusColor(status)}${padded}${colors.reset}`;
		}
		if (index === 0 && isSelected) {
			return `${colors.cyan}${colors.bold}${padded}${colors.reset}`;
		}

		return padded;
	};

	const renderInstanceRow = (
		instance: LiveInstance,
		widths: number[],
		isSelected: boolean
	) => {
		const body = instanceRowCells(instance)
			.map((cell, index) =>
				colorizeCell(cell, index, instance.status, isSelected, widths)
			)
			.join(' '.repeat(LIST_TUI_COLUMN_GAP));
		const marker = isSelected ? `${colors.cyan}❯${colors.reset}` : ' ';

		return `${marker} ${body}`;
	};

	const pushInstanceRows = (rows: string[], width: number) => {
		if (instances.length === 0) {
			rows.push(
				padLine(
					`${colors.dim}No servers running. Start one with \`absolute dev\`.${colors.reset}`,
					width
				)
			);

			return;
		}
		const allCells = instances.map(instanceRowCells);
		const widths = layoutWidths(allCells, width);
		const header = TUI_HEADERS.map((label, index) =>
			padLine(label, widths[index] ?? 0)
		).join(' '.repeat(LIST_TUI_COLUMN_GAP));
		rows.push(padLine(`  ${colors.dim}${header}${colors.reset}`, width));
		instances.forEach((instance, index) => {
			rows.push(
				padLine(
					renderInstanceRow(
						instance,
						widths,
						index === selectedIndex
					),
					width
				)
			);
		});
	};

	const logContentLines = (width: number) => {
		if (helpVisible) return helpLines;

		const instance = selectedInstance();
		if (!instance) {
			return [`${colors.dim}No server selected.${colors.reset}`];
		}
		const lines = readLogTail(instance.logFile);
		if (lines.length === 0) {
			return [`${colors.dim}No output yet.${colors.reset}`];
		}

		return lines.map((line) =>
			truncateText(stripAnsi(line), Math.max(1, width - 1))
		);
	};

	const pushLogRows = (rows: string[], width: number, logHeight: number) => {
		const contentLines = logContentLines(width);
		lastLogLineCount = contentLines.length;
		lastLogViewportHeight = logHeight;
		const end = helpVisible
			? Math.min(contentLines.length, logHeight)
			: Math.max(0, contentLines.length - logScrollOffset);
		const start = helpVisible ? 0 : Math.max(0, end - logHeight);
		const visible = contentLines.slice(start, end);
		visible.forEach((line) => rows.push(padLine(line, width)));
		for (let index = visible.length; index < logHeight; index++) {
			rows.push(' '.repeat(width));
		}
	};

	const footerLine = (width: number) => {
		if (helpVisible) {
			return padLine(
				`${colors.dim}esc or ? closes help${colors.reset}`,
				width
			);
		}
		if (mode === 'port') {
			return padLine(
				`${colors.yellow}free port:${colors.reset} ${portBuffer}▌  ${colors.dim}enter to kill · esc to cancel${colors.reset}`,
				width
			);
		}
		if (mode === 'confirm') {
			return padLine(
				`${colors.yellow}Stop ALL ${instances.length} servers? ${colors.reset}${colors.bold}y${colors.reset}${colors.dim}/N${colors.reset}`,
				width
			);
		}
		const hint =
			'↑↓ select · s stop · r restart · o open · f free port · x stop all · ? help · q quit';

		return padLine(
			`${colors.dim}${truncateText(hint, width)}${colors.reset}`,
			width
		);
	};

	const statusLine = (width: number) => {
		if (!statusMessage) {
			return padLine(
				`${colors.dim}live · refreshing every ${LIST_WATCH_REFRESH_MS}ms${colors.reset}`,
				width
			);
		}

		return padLine(
			`${statusLevelColor(statusMessage.level)}${statusMessage.text}${colors.reset}`,
			width
		);
	};

	const render = () => {
		if (disposed) return;

		const width = process.stdout.columns ?? LIST_TUI_DEFAULT_WIDTH;
		const height = process.stdout.rows ?? LIST_TUI_DEFAULT_HEIGHT;
		const rows: string[] = [];
		rows.push(padLine(titleLine(width), width));
		rows.push(dividerLine(width));
		pushInstanceRows(rows, width);
		rows.push(dividerLine(width));
		const instance = selectedInstance();
		const logTitle =
			helpVisible || !instance
				? 'logs'
				: `logs · ${instance.name}${instance.frameworks.length > 0 ? ` · ${instance.frameworks.join(', ')}` : ''}`;
		rows.push(padLine(`${colors.bold}${logTitle}${colors.reset}`, width));
		const fixedHeight = rows.length + LIST_TUI_FOOTER_LINE_COUNT + 1;
		const logHeight = Math.max(
			height - fixedHeight,
			LIST_TUI_MIN_LOG_HEIGHT
		);
		pushLogRows(rows, width, logHeight);
		rows.push(dividerLine(width));
		rows.push(statusLine(width));
		rows.push(footerLine(width));

		const screen = rows
			.slice(0, height)
			.map((line) => `\x1b[2K${line}`)
			.join('\n');
		process.stdout.write(`\x1b[H${screen}\x1b[?25l`);
	};

	process.on('SIGINT', quit);
	process.on('SIGTERM', quit);
	process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l');
	terminal.resume();
	terminal.on('data', onData);
	process.stdout.on('resize', onResize);
	refreshTimer = setInterval(() => {
		void refresh();
	}, LIST_WATCH_REFRESH_MS);
	await refresh();
	render();
	await promise;
};

export const runPsTui = async () => {
	const input = openTtyStream();
	if (!input) {
		process.stdout.write(
			'Interactive ps requires a TTY. Run `absolute ps` for a snapshot.\n'
		);

		return;
	}

	await driveListTui(input);
};
