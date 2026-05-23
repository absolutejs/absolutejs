import type { ServiceVisibility } from '../../types/build';
import {
	ASCII_SPACE,
	UNFOUND_INDEX,
	WORKSPACE_TUI_DEFAULT_HEIGHT,
	WORKSPACE_TUI_DEFAULT_WIDTH,
	WORKSPACE_TUI_ESCAPE_SEQUENCE_TIMEOUT_MS,
	WORKSPACE_TUI_FOOTER_LINE_COUNT,
	WORKSPACE_TUI_MIN_LOG_HEIGHT,
	WORKSPACE_TUI_MIN_SERVICE_NAME_WIDTH,
	WORKSPACE_TUI_MIN_TARGET_WIDTH,
	WORKSPACE_TUI_MIN_WRAP_WIDTH,
	WORKSPACE_TUI_PROMPT_CURSOR_OFFSET,
	WORKSPACE_TUI_RECENT_LOG_LIMIT,
	WORKSPACE_TUI_RENDER_DEBOUNCE_MS,
	WORKSPACE_TUI_STATUS_WIDTH,
	WORKSPACE_TUI_TARGET_PADDING_WIDTH,
	WORKSPACE_TUI_VISIBILITY_WIDTH
} from '../constants';
import {
	ESCAPE,
	appendRightEdge,
	colors,
	formatTimestamp,
	isPartialEscapeSequence,
	openTtyStream,
	padLine,
	stripAnsi,
	truncateText,
	wrapText
} from './tuiPrimitives';
import { getDurationString } from '../utils/getDurationString';

type WorkspaceTuiStatus =
	| 'pending'
	| 'starting'
	| 'ready'
	| 'paused'
	| 'restarting'
	| 'stopped'
	| 'error';

type WorkspaceTuiLogLevel = 'info' | 'warn' | 'error' | 'success';

type WorkspaceTuiService = {
	name: string;
	port?: number;
	url?: string | null;
	visibility: ServiceVisibility;
};

type WorkspaceTuiActions = {
	open: () => void | Promise<void>;
	pause: () => void | Promise<void>;
	quit: () => void | Promise<void>;
	restart: () => void | Promise<void>;
	shell: (command: string) => void | Promise<void>;
};

type WorkspaceLogEntry = {
	level: WorkspaceTuiLogLevel;
	message: string;
	source: string;
	timestamp: string;
};

type ServiceState = WorkspaceTuiService & {
	detail?: string;
	status: WorkspaceTuiStatus;
};

type WorkspaceInput = {
	destroy: () => void;
	off: (event: 'data', listener: (chunk: Buffer) => void) => void;
	on: (event: 'data', listener: (chunk: Buffer) => void) => void;
	resume: () => void;
	setRawMode?: (enabled: boolean) => void;
};

const MAX_LOG_ENTRIES = 400;

const SHORTCUTS = new Map<
	string,
	'clear' | 'help' | keyof Omit<WorkspaceTuiActions, 'shell'>
>([
	['c', 'clear'],
	['h', 'help'],
	['o', 'open'],
	['p', 'pause'],
	['q', 'quit'],
	['r', 'restart']
]);

const helpLines = [
	'Hotkeys',
	'  h  Toggle help',
	'  o  Open the first ready public service',
	'  r  Restart the workspace',
	'  p  Pause or resume all services',
	'  ↑/↓  Scroll logs one line',
	'  PgUp/PgDn  Scroll logs one page',
	'  Home/End  Jump to oldest or latest logs',
	'  c  Clear the log pane',
	'  q  Quit',
	'  $  Enter shell mode',
	'',
	'Shell mode',
	'  Type a shell command after "$" and press enter.',
	'  Press Esc to exit shell mode or dismiss help.',
	'  Use ↑ and ↓ to recall prior shell commands.'
];

const getStatusColor = (status: WorkspaceTuiStatus) => {
	if (status === 'ready') return colors.green;
	if (status === 'paused') return colors.yellow;
	if (status === 'starting' || status === 'restarting') return colors.cyan;
	if (status === 'error') return colors.red;

	return colors.dim;
};

const getLogColor = (level: WorkspaceTuiLogLevel) => {
	if (level === 'error') return colors.red;
	if (level === 'warn') return colors.yellow;
	if (level === 'success') return colors.green;

	return colors.reset;
};

const getSourceColor = (source: string) => {
	if (source === 'workspace') return colors.cyan;
	if (source === 'shell') return colors.yellow;

	return colors.reset;
};

const getTargetLabel = (service: ServiceState) => {
	if (service.visibility === 'public' && service.url) {
		if (service.status === 'ready') {
			return service.url;
		}
		if (service.port) {
			return `public endpoint pending (:${service.port})`;
		}

		return 'public endpoint pending';
	}
	if (service.port) {
		return `localhost:${service.port} (internal)`;
	}

	return service.visibility === 'internal'
		? 'internal service'
		: 'no endpoint';
};

const getWorkspaceStatus = (services: ServiceState[]) => {
	if (services.some((service) => service.status === 'error')) {
		return 'error';
	}
	if (services.some((service) => service.status === 'paused')) {
		return 'paused';
	}
	if (
		services.some((service) =>
			['pending', 'starting', 'restarting'].includes(service.status)
		)
	) {
		return 'booting';
	}

	return 'ready';
};

const getVisibleLogContent = (
	contentLines: string[],
	logHeight: number,
	logScrollOffset: number
) => {
	const end = Math.max(0, contentLines.length - logScrollOffset);
	const start = Math.max(0, end - logHeight);

	return contentLines.slice(start, end);
};

export const createWorkspaceTui = ({
	actions,
	headless: headlessOption,
	services,
	version
}: {
	actions: WorkspaceTuiActions;
	headless?: boolean;
	services: WorkspaceTuiService[];
	version: string;
}) => {
	// The interactive dashboard needs a real terminal: it enters the alternate
	// screen buffer and reads raw keyboard input. Detect usable input by
	// *probing* (openTtyStream) rather than trusting flags — some PTY wrappers
	// (CI runners, AI agents such as Claude Code) report stdin.isTTY and expose
	// setRawMode yet throw when raw mode is actually enabled. When no interactive
	// input can be acquired (or headless is forced via `--no-tui`/CI), stream
	// plain logs instead of a dashboard nobody can render or drive.
	const headlessForced =
		headlessOption === true ||
		process.env.CI === '1' ||
		process.env.CI === 'true';
	const input: WorkspaceInput | null = headlessForced
		? null
		: openTtyStream();
	const headless = headlessForced || (headlessOption !== false && !input);
	let disposed = false;
	let renderTimer: NodeJS.Timeout | null = null;
	let shellMode = false;
	let helpVisible = false;
	let promptBuffer = '';
	let escapeTimer: NodeJS.Timeout | null = null;
	let escapeBuffer = '';
	let readyDurationMs: number | null = null;
	let logScrollOffset = 0;
	let lastLogLineCount = 0;
	let lastLogViewportHeight = 0;
	const shellHistory: string[] = [];
	let shellHistoryIndex = UNFOUND_INDEX;
	const serviceStates = new Map<string, ServiceState>(
		services.map((service) => [
			service.name,
			{
				...service,
				status: 'pending'
			}
		])
	);
	const logEntries: WorkspaceLogEntry[] = [];

	const setRawMode = (enabled: boolean) => {
		if (!input || typeof input.setRawMode !== 'function') {
			return;
		}
		try {
			input.setRawMode(enabled);
		} catch {
			/* tty may already be closed */
		}
	};

	const scheduleRender = () => {
		if (headless || disposed || renderTimer) {
			return;
		}
		renderTimer = setTimeout(() => {
			renderTimer = null;
			render();
		}, WORKSPACE_TUI_RENDER_DEBOUNCE_MS);
	};

	const clearPendingEscape = () => {
		if (!escapeTimer) {
			return;
		}
		clearTimeout(escapeTimer);
		escapeTimer = null;
	};

	const armEscapeTimer = () => {
		clearPendingEscape();
		escapeTimer = setTimeout(() => {
			escapeTimer = null;
			escapeBuffer = '';
			exitEscapeMode();
		}, WORKSPACE_TUI_ESCAPE_SEQUENCE_TIMEOUT_MS);
	};

	const resetPrompt = () => {
		promptBuffer = '';
		shellMode = false;
		shellHistoryIndex = UNFOUND_INDEX;
		scheduleRender();
	};

	const exitEscapeMode = () => {
		clearPendingEscape();
		escapeBuffer = '';
		if (helpVisible) {
			helpVisible = false;
		} else {
			resetPrompt();
		}
		scheduleRender();
	};

	const render = () => {
		if (disposed) {
			return;
		}

		const width = process.stdout.columns ?? WORKSPACE_TUI_DEFAULT_WIDTH;
		const height = process.stdout.rows ?? WORKSPACE_TUI_DEFAULT_HEIGHT;
		const servicesSnapshot = [...serviceStates.values()];
		const workspaceStatus = getWorkspaceStatus(servicesSnapshot);
		const statusLabel =
			workspaceStatus === 'ready' && readyDurationMs !== null
				? `${colors.dim}ready in${colors.reset} ${colors.bold}${getDurationString(readyDurationMs)}${colors.reset}`
				: `${colors.dim}${workspaceStatus}${colors.reset}`;
		const title = `${colors.cyan}${colors.bold}ABSOLUTEJS WORKSPACE${colors.reset} ${colors.dim}v${version}${colors.reset}  ${statusLabel}`;
		const divider = `${colors.dim}${'─'.repeat(Math.max(width, 1))}${colors.reset}`;

		const serviceNameWidth = Math.max(
			WORKSPACE_TUI_MIN_SERVICE_NAME_WIDTH,
			...servicesSnapshot.map((service) => service.name.length)
		);
		const visibilityWidth = WORKSPACE_TUI_VISIBILITY_WIDTH;
		const statusWidth = WORKSPACE_TUI_STATUS_WIDTH;

		const rows: string[] = [];
		rows.push(padLine(title, width));
		rows.push(divider);
		rows.push(padLine(`${colors.bold}Services${colors.reset}`, width));

		for (const service of servicesSnapshot) {
			const stateColor = getStatusColor(service.status);
			const detail = service.detail ? ` · ${service.detail}` : '';
			const targetWidth = Math.max(
				width -
					serviceNameWidth -
					visibilityWidth -
					statusWidth -
					WORKSPACE_TUI_TARGET_PADDING_WIDTH,
				WORKSPACE_TUI_MIN_TARGET_WIDTH
			);
			const target = truncateText(
				`${getTargetLabel(service)}${detail}`,
				targetWidth
			);
			const targetColor =
				service.visibility === 'public' && service.status !== 'ready'
					? colors.dim
					: colors.reset;
			const row = `${colors.bold}${service.name.padEnd(serviceNameWidth)}${colors.reset}  ${colors.dim}${service.visibility.padEnd(
				visibilityWidth
			)}${colors.reset}  ${stateColor}${service.status.padEnd(
				statusWidth
			)}${colors.reset}  ${targetColor}${target}${colors.reset}`;
			rows.push(padLine(row, width));
		}

		rows.push(divider);

		const footerLines = WORKSPACE_TUI_FOOTER_LINE_COUNT;
		const fixedHeight = rows.length + footerLines;
		const logHeight = Math.max(
			height - fixedHeight,
			WORKSPACE_TUI_MIN_LOG_HEIGHT
		);
		const logWidth = Math.max(width - 1, 1);
		const contentLines = helpVisible
			? helpLines
			: logEntries.flatMap((entry) => {
					const prefixPlain = `${entry.timestamp} [${entry.source}] `;
					const prefixColor = `${colors.dim}${entry.timestamp}${colors.reset} ${getSourceColor(
						entry.source
					)}[${entry.source}]${colors.reset} `;
					const wrapped = wrapText(
						entry.message,
						Math.max(
							logWidth - prefixPlain.length,
							WORKSPACE_TUI_MIN_WRAP_WIDTH
						)
					);

					return wrapped.map((line, index) => {
						if (index === 0) {
							return `${prefixColor}${getLogColor(entry.level)}${line}${colors.reset}`;
						}

						return `${' '.repeat(prefixPlain.length)}${getLogColor(entry.level)}${line}${colors.reset}`;
					});
				});

		if (!helpVisible) {
			lastLogLineCount = contentLines.length;
			lastLogViewportHeight = logHeight;
			logScrollOffset = Math.min(
				logScrollOffset,
				Math.max(0, contentLines.length - logHeight)
			);
		}

		const visibleContent = helpVisible
			? contentLines.slice(0, logHeight)
			: getVisibleLogContent(contentLines, logHeight, logScrollOffset);
		const maxLogScrollOffset = !helpVisible
			? Math.max(0, contentLines.length - logHeight)
			: 0;
		const shouldShowScrollbar = !helpVisible && maxLogScrollOffset > 0;
		const scrollbarThumbHeight = shouldShowScrollbar
			? Math.max(
					1,
					Math.min(
						logHeight,
						Math.round(
							(logHeight / contentLines.length) * logHeight
						)
					)
				)
			: 0;
		const scrollbarMaxTop = Math.max(0, logHeight - scrollbarThumbHeight);
		const scrollbarTop =
			shouldShowScrollbar && maxLogScrollOffset > 0
				? Math.round(
						((maxLogScrollOffset - logScrollOffset) /
							maxLogScrollOffset) *
							scrollbarMaxTop
					)
				: 0;
		const getScrollbarMarker = (index: number) => {
			if (!shouldShowScrollbar) {
				return null;
			}

			const inThumb =
				index >= scrollbarTop &&
				index < scrollbarTop + scrollbarThumbHeight;

			return inThumb
				? `${colors.cyan}█${colors.reset}`
				: `${colors.dim}│${colors.reset}`;
		};

		for (let index = 0; index < visibleContent.length; index++) {
			const marker = getScrollbarMarker(index);
			rows.push(
				marker
					? appendRightEdge(
							visibleContent[index] ?? '',
							width,
							marker
						)
					: padLine(visibleContent[index] ?? '', width)
			);
		}
		for (let index = visibleContent.length; index < logHeight; index++) {
			const marker = getScrollbarMarker(index);
			rows.push(
				marker ? appendRightEdge('', width, marker) : ' '.repeat(width)
			);
		}

		rows.push(divider);
		const logState =
			!helpVisible && logScrollOffset > 0
				? `logs scrolled back ${logScrollOffset} line${logScrollOffset === 1 ? '' : 's'} · End for latest`
				: 'live logs';
		const footerText = helpVisible
			? 'Esc or h closes help'
			: `Hotkeys: h help  ↑/↓ scroll  PgUp/PgDn page  End latest  c clear  q quit  $ shell · ${logState}`;
		rows.push(
			padLine(
				`${colors.dim}${truncateText(footerText, width)}${colors.reset}`,
				width
			)
		);

		const promptLine = shellMode
			? `${colors.yellow}$ ${colors.reset}${truncateText(
					promptBuffer,
					Math.max(width - 2, 0)
				)}`
			: `${colors.dim}Press a hotkey or $ for shell mode${colors.reset}`;
		rows.push(padLine(promptLine, width));

		const screen = rows
			.slice(0, height)
			.map((line) => `\x1b[2K${line}`)
			.join('\n');

		process.stdout.write(`\x1b[H${screen}`);
		if (shellMode) {
			const promptColumn = Math.min(
				promptBuffer.length + WORKSPACE_TUI_PROMPT_CURSOR_OFFSET,
				width
			);
			const promptRow = Math.min(rows.length, height);
			process.stdout.write(`\x1b[${promptRow};${promptColumn}H\x1b[?25h`);

			return;
		}
		process.stdout.write('\x1b[?25l');
	};

	const setServiceStatus = (
		name: string,
		status: WorkspaceTuiStatus,
		detail?: string
	) => {
		const existing = serviceStates.get(name);
		if (!existing) {
			return;
		}
		existing.status = status;
		existing.detail = detail;
		if (headless) {
			addLog(
				'workspace',
				`${name} ${status}${detail ? ` — ${detail}` : ''}`,
				status === 'error' ? 'error' : 'info'
			);
		}
		scheduleRender();
	};

	const setReadyDuration = (durationMs: number | null) => {
		readyDurationMs = durationMs;
		if (headless && durationMs !== null) {
			addLog(
				'workspace',
				`workspace ready in ${getDurationString(durationMs)}`
			);
		}
		scheduleRender();
	};

	const addLog = (
		source: string,
		message: string,
		level: WorkspaceTuiLogLevel = 'info'
	) => {
		const cleanMessage = stripAnsi(message).trimEnd();
		if (!cleanMessage) {
			return;
		}

		for (const line of cleanMessage.split('\n')) {
			const timestamp = formatTimestamp();
			logEntries.push({ level, message: line, source, timestamp });
			if (headless) {
				const levelColor =
					level === 'error'
						? colors.red
						: level === 'warn'
							? colors.yellow
							: colors.dim;
				process.stdout.write(
					`${colors.dim}${timestamp}${colors.reset} ${levelColor}${source}${colors.reset} ${line}\n`
				);
			}
		}
		if (logEntries.length > MAX_LOG_ENTRIES) {
			logEntries.splice(0, logEntries.length - MAX_LOG_ENTRIES);
		}
		scheduleRender();
	};

	const clearLogs = () => {
		logEntries.length = 0;
		logScrollOffset = 0;
		scheduleRender();
	};

	const getRecentLogs = (limit = WORKSPACE_TUI_RECENT_LOG_LIMIT) =>
		logEntries.slice(Math.max(0, logEntries.length - limit));

	const getServiceSnapshot = () =>
		[...serviceStates.values()].map((service) => ({
			detail: service.detail,
			name: service.name,
			status: service.status,
			target: getTargetLabel(service),
			visibility: service.visibility
		}));

	const navigateShellHistory = (direction: 'up' | 'down') => {
		if (!shellMode || shellHistory.length === 0) {
			return;
		}

		if (direction === 'up' && shellHistoryIndex < shellHistory.length - 1) {
			shellHistoryIndex++;
		}
		if (direction === 'down' && shellHistoryIndex <= 0) {
			shellHistoryIndex = UNFOUND_INDEX;
			promptBuffer = '';
			scheduleRender();

			return;
		}
		if (direction === 'down') {
			shellHistoryIndex--;
		}

		promptBuffer =
			shellHistoryIndex === UNFOUND_INDEX
				? ''
				: (shellHistory[shellHistory.length - 1 - shellHistoryIndex] ??
					'');
		scheduleRender();
	};

	const handleArrowEscape = (direction: 'up' | 'down') => {
		clearPendingEscape();
		escapeBuffer = '';
		if (shellMode) {
			navigateShellHistory(direction);

			return;
		}

		scrollLogs(direction);
	};

	const handleScrollEscape = (
		mode: 'pageUp' | 'pageDown' | 'home' | 'end'
	) => {
		clearPendingEscape();
		escapeBuffer = '';
		scrollLogs(mode);
	};

	const scrollLogs = (
		direction: 'up' | 'down' | 'pageUp' | 'pageDown' | 'home' | 'end'
	) => {
		if (helpVisible) {
			return;
		}

		const maxOffset = Math.max(0, lastLogLineCount - lastLogViewportHeight);
		const pageSize = Math.max(1, lastLogViewportHeight - 1);

		if (direction === 'up') {
			logScrollOffset = Math.min(maxOffset, logScrollOffset + 1);
		} else if (direction === 'down') {
			logScrollOffset = Math.max(0, logScrollOffset - 1);
		} else if (direction === 'pageUp') {
			logScrollOffset = Math.min(maxOffset, logScrollOffset + pageSize);
		} else if (direction === 'pageDown') {
			logScrollOffset = Math.max(0, logScrollOffset - pageSize);
		} else if (direction === 'home') {
			logScrollOffset = maxOffset;
		} else {
			logScrollOffset = 0;
		}

		scheduleRender();
	};

	const runShortcut = async (
		action: 'clear' | 'help' | keyof Omit<WorkspaceTuiActions, 'shell'>
	) => {
		if (action === 'clear') {
			clearLogs();

			return;
		}
		if (action === 'help') {
			helpVisible = !helpVisible;
			scheduleRender();

			return;
		}

		await actions[action]();
	};

	const submitShellCommand = async () => {
		const command = promptBuffer.trim();
		if (!command) {
			resetPrompt();

			return;
		}

		shellHistory.push(command);
		resetPrompt();
		addLog('shell', `$ ${command}`, 'info');
		await actions.shell(command);
	};

	const handleEscapeSequence = (char: string) => {
		if (!escapeBuffer) {
			escapeBuffer = ESCAPE;
		}
		escapeBuffer += char;
		if (escapeBuffer === `${ESCAPE}[`) {
			armEscapeTimer();

			return;
		}
		if (escapeBuffer === `${ESCAPE}[A`) {
			handleArrowEscape('up');

			return;
		}
		if (escapeBuffer === `${ESCAPE}[B`) {
			handleArrowEscape('down');

			return;
		}
		if (escapeBuffer === `${ESCAPE}[5~`) {
			handleScrollEscape('pageUp');

			return;
		}
		if (escapeBuffer === `${ESCAPE}[6~`) {
			handleScrollEscape('pageDown');

			return;
		}
		if (escapeBuffer === `${ESCAPE}[H` || escapeBuffer === `${ESCAPE}[1~`) {
			handleScrollEscape('home');

			return;
		}
		if (escapeBuffer === `${ESCAPE}[F` || escapeBuffer === `${ESCAPE}[4~`) {
			handleScrollEscape('end');

			return;
		}
		if (isPartialEscapeSequence(escapeBuffer)) {
			armEscapeTimer();

			return;
		}
		exitEscapeMode();
	};

	const handleBackspace = () => {
		if (!shellMode) {
			return;
		}
		if (promptBuffer.length > 0) {
			promptBuffer = promptBuffer.slice(0, UNFOUND_INDEX);
			scheduleRender();

			return;
		}
		resetPrompt();
	};

	const handleEnter = async () => {
		if (!shellMode) {
			return;
		}

		await submitShellCommand();
	};

	const handlePrintableChar = async (char: string) => {
		if (shellMode) {
			promptBuffer += char;
			scheduleRender();

			return;
		}
		if (char === '$') {
			shellMode = true;
			promptBuffer = '';
			scheduleRender();

			return;
		}

		const shortcut = SHORTCUTS.get(char.toLowerCase());
		if (shortcut) {
			await runShortcut(shortcut);
		}
	};

	const handleChar = async (char: string) => {
		if (char === '\x03') {
			await actions.quit();

			return;
		}

		if (char === ESCAPE) {
			escapeBuffer = ESCAPE;
			armEscapeTimer();

			return;
		}

		if (escapeBuffer) {
			handleEscapeSequence(char);

			return;
		}

		if (char === '\x7f' || char === '\b') {
			handleBackspace();

			return;
		}

		if (char === '\r' || char === '\n') {
			await handleEnter();

			return;
		}

		if (char.charCodeAt(0) < ASCII_SPACE) {
			return;
		}

		await handlePrintableChar(char);
	};

	const processInputChars = async (chars: string) => {
		await Array.from(chars).reduce(
			(chain, char) => chain.then(() => handleChar(char)),
			Promise.resolve()
		);
	};

	const onResize = () => {
		scheduleRender();
	};

	const onData = (chunk: Buffer) => {
		const chars = chunk.toString();
		void processInputChars(chars);
	};

	const start = () => {
		if (headless) {
			addLog(
				'workspace',
				`ABSOLUTEJS WORKSPACE v${version} — headless mode (no interactive TTY); streaming logs. Ctrl+C to stop.`
			);
			for (const service of serviceStates.values()) {
				const target =
					service.url ??
					(service.port ? `:${service.port}` : 'internal');
				addLog(
					'workspace',
					`${service.name} (${service.visibility}) ${target}`
				);
			}

			return;
		}
		process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l');
		if (input) {
			input.resume();
			input.on('data', onData);
		} else {
			addLog(
				'workspace',
				'Interactive TTY input is unavailable in this terminal.',
				'warn'
			);
		}
		process.stdout.on('resize', onResize);
		render();
	};

	const disposeInput = () => {
		if (!input) {
			return;
		}

		input.off('data', onData);
		setRawMode(false);
		if (input !== process.stdin) {
			input.destroy();
		}
	};

	const dispose = () => {
		if (disposed) {
			return;
		}
		disposed = true;
		if (headless) {
			return;
		}
		clearPendingEscape();
		if (renderTimer) {
			clearTimeout(renderTimer);
			renderTimer = null;
		}
		process.stdout.off('resize', onResize);
		disposeInput();
		process.stdout.write('\x1b[?25h\x1b[?1049l');
	};

	return {
		addLog,
		clearLogs,
		dispose,
		getRecentLogs,
		getServiceSnapshot,
		setReadyDuration,
		setServiceStatus,
		start
	};
};
