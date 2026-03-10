import { openSync } from 'node:fs';
import { ReadStream } from 'node:tty';
import type { Actions, InteractiveHandler } from '../../types/cli';
import { ANSI_ESCAPE_LENGTH, ASCII_SPACE, UNFOUND_INDEX } from '../constants';

const SHORTCUTS: Record<string, keyof Omit<Actions, 'shell'>> = {
	c: 'clear',
	h: 'help',
	o: 'open',
	p: 'pause',
	q: 'quit',
	r: 'restart'
};

const WORD_COMMANDS: Record<string, keyof Omit<Actions, 'shell'>> = {
	clear: 'clear',
	help: 'help',
	open: 'open',
	pause: 'pause',
	quit: 'quit',
	restart: 'restart',
	resume: 'pause'
};

const trySetRawMode = () => {
	if (typeof process.stdin.setRawMode !== 'function') {
		return null;
	}

	try {
		process.stdin.setRawMode(true);
	} catch {
		return null;
	}

	return process.stdin as unknown as ReadStream;
};

const openTtyStream = () => {
	const fromStdin = trySetRawMode();
	if (fromStdin) {
		return fromStdin;
	}

	try {
		const ttyStream = new ReadStream(openSync('/dev/tty', 'r'));
		ttyStream.setRawMode(true);

		return ttyStream;
	} catch {
		return null;
	}
};

const runShellCommand = async (actions: Actions, cmd: string) => {
	try {
		await actions.shell(cmd);
	} catch {
		/* command failed */
	}
};

const handleActionResult = (
	action: string,
	renderLine: (value: string) => void,
	setNeedsPrompt: (value: boolean) => void
) => {
	if (action === 'restart') {
		setNeedsPrompt(true);

		return;
	}

	renderLine('');
};

export const createInteractiveHandler = (
	actions: Actions
): InteractiveHandler => {
	let buffer = '';
	let shellMode = false;
	let needsPrompt = true;
	let escapeSeq = '';
	const history: string[] = [];
	let historyIndex = UNFOUND_INDEX;

	const setNeedsPrompt = (value: boolean) => {
		needsPrompt = value;
	};

	const renderLine = (value: string) => {
		const prefix = shellMode ? '\x1b[33m$ \x1b[0m' : '\x1b[90m> \x1b[0m';
		process.stdout.write(`\r\x1b[2K${prefix}${value}`);
		buffer = value;
		needsPrompt = false;
	};

	const handleLine = async (line: string) => {
		const trimmed = line.trim();
		if (trimmed === '') {
			renderLine('');

			return;
		}

		if (trimmed === '$') {
			shellMode = true;
			renderLine('');

			return;
		}

		if (trimmed.startsWith('$')) {
			const cmd = trimmed.slice(1).trim();
			if (cmd.length === 0) {
				return;
			}

			await runShellCommand(actions, cmd);
			renderLine('');

			return;
		}

		const wordAction = WORD_COMMANDS[trimmed.toLowerCase()];
		if (wordAction) {
			await actions[wordAction]();
			handleActionResult(wordAction, renderLine, setNeedsPrompt);

			return;
		}

		if (trimmed.length !== 1) {
			console.log(
				`\x1b[31mUnknown command: ${trimmed}\x1b[0m (press h + enter for help)`
			);
			renderLine('');

			return;
		}

		const shortcutAction = SHORTCUTS[trimmed];
		if (!shortcutAction) {
			console.log(
				`\x1b[31mUnknown command: ${trimmed}\x1b[0m (press h + enter for help)`
			);
			renderLine('');

			return;
		}

		await actions[shortcutAction]();
		handleActionResult(shortcutAction, renderLine, setNeedsPrompt);
	};

	const handleShellLine = async (line: string) => {
		const trimmed = line.trim();
		if (trimmed === '') {
			shellMode = false;
			renderLine('');

			return;
		}

		try {
			await actions.shell(trimmed);
		} catch {
			/* command failed or was cancelled */
		}
		shellMode = false;
		renderLine('');
	};

	const navigateHistoryUp = () => {
		if (history.length === 0) {
			return;
		}

		if (historyIndex < history.length - 1) {
			historyIndex++;
		}
		const entry = history[history.length - 1 - historyIndex];
		if (entry) renderLine(entry);
	};

	const navigateHistoryDown = () => {
		if (historyIndex <= 0) {
			historyIndex = UNFOUND_INDEX;
			renderLine('');

			return;
		}

		historyIndex--;
		const entry = history[history.length - 1 - historyIndex];
		if (entry) renderLine(entry);
	};

	const handleArrow = (arrow: string) => {
		if (arrow === 'A') navigateHistoryUp();
		if (arrow === 'B') navigateHistoryDown();
	};

	const handleCtrlC = () => {
		const wasShellMode = shellMode;
		shellMode = false;
		buffer = '';
		historyIndex = UNFOUND_INDEX;
		process.stdout.write('\n');
		if (wasShellMode) {
			needsPrompt = true;

			return;
		}

		actions.quit();
	};

	const handleEnter = () => {
		process.stdout.write('\n');
		const line = buffer;
		buffer = '';
		historyIndex = UNFOUND_INDEX;

		if (line.trim().length > 0) history.push(line);
		if (shellMode) handleShellLine(line);
		else handleLine(line);
	};

	const handleChar = (char: string) => {
		if (char === '\x03') {
			handleCtrlC();

			return;
		}

		if (char === '\x7f' || char === '\b') {
			if (buffer.length > 0) renderLine(buffer.slice(0, UNFOUND_INDEX));

			return;
		}

		if (char === '\r' || char === '\n') {
			handleEnter();

			return;
		}

		if (char.charCodeAt(0) < ASCII_SPACE) {
			return;
		}

		if (needsPrompt) {
			process.stdout.write('\n');
		}
		renderLine(buffer + char);
	};

	const processEscapeChar = (char: string) => {
		escapeSeq += char;

		if (escapeSeq.length === 2 && char !== '[') {
			escapeSeq = '';

			return;
		}

		if (escapeSeq.length === ANSI_ESCAPE_LENGTH) {
			handleArrow(char);
			escapeSeq = '';
		}
	};

	const processChar = (char: string) => {
		if (escapeSeq.length > 0) {
			processEscapeChar(char);

			return;
		}

		if (char === '\x1b') {
			escapeSeq = '\x1b';

			return;
		}

		handleChar(char);
	};

	const onData = (data: Buffer) => {
		const str = data.toString();

		for (let idx = 0; idx < str.length; idx++) {
			processChar(str.charAt(idx));
		}
	};

	const ttyStream = openTtyStream();
	const input = ttyStream ?? process.stdin;

	input.resume();
	input.on('data', onData);

	const disposeTtyStream = () => {
		if (!ttyStream) {
			return;
		}

		try {
			ttyStream.setRawMode(false);
		} catch {
			/* already closed */
		}
		if (ttyStream !== (process.stdin as unknown)) {
			ttyStream.destroy();
		}
	};

	const dispose = () => {
		input.removeListener('data', onData);
		disposeTtyStream();
		process.stdin.pause();
	};

	const clearPrompt = () => {
		process.stdout.write('\r\x1b[2K');
	};

	const showPrompt = () => {
		renderLine(buffer);
	};

	return { clearPrompt, dispose, showPrompt };
};
