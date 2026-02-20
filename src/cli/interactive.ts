import { openSync } from 'node:fs';
import { ReadStream } from 'node:tty';
import type { Actions, InteractiveHandler } from '../../types/cli';

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

const openTtyStream = (): ReadStream | null => {
	// Try process.stdin first if it supports raw mode
	if (typeof process.stdin.setRawMode === 'function') {
		try {
			process.stdin.setRawMode(true);

			return process.stdin as unknown as ReadStream;
		} catch {
			/* stdin is not a real TTY */
		}
	}

	// Fallback: open /dev/tty directly to bypass piped stdin
	try {
		const ttyStream = new ReadStream(openSync('/dev/tty', 'r'));
		ttyStream.setRawMode(true);

		return ttyStream;
	} catch {
		return null;
	}
};

export const createInteractiveHandler = (
	actions: Actions
): InteractiveHandler => {
	let buffer = '';
	let shellMode = false;
	let needsPrompt = true;
	let escapeSeq = '';
	const history: string[] = [];
	let historyIndex = -1;

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
			if (cmd.length > 0) {
				try {
					await actions.shell(cmd);
				} catch {
					/* command failed */
				}
				renderLine('');

				return;
			}
		}

		const wordAction = WORD_COMMANDS[trimmed.toLowerCase()];
		if (wordAction) {
			await actions[wordAction]();
			if (wordAction === 'restart') {
				needsPrompt = true;
			} else {
				renderLine('');
			}

			return;
		}

		if (trimmed.length === 1) {
			const shortcutAction = SHORTCUTS[trimmed];
			if (shortcutAction) {
				await actions[shortcutAction]();
				if (shortcutAction === 'restart') {
					needsPrompt = true;
				} else {
					renderLine('');
				}

				return;
			}
		}

		console.log(
			`\x1b[31mUnknown command: ${trimmed}\x1b[0m (press h + enter for help)`
		);
		renderLine('');
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

	const handleArrow = (arrow: string) => {
		// Up arrow
		if (arrow === 'A' && history.length > 0) {
			if (historyIndex < history.length - 1) {
				historyIndex++;
			}
			const entry = history[history.length - 1 - historyIndex];
			if (entry) renderLine(entry);
		}

		// Down arrow
		if (arrow === 'B') {
			if (historyIndex > 0) {
				historyIndex--;
				const entry = history[history.length - 1 - historyIndex];
				if (entry) renderLine(entry);
			} else {
				historyIndex = -1;
				renderLine('');
			}
		}
	};

	const handleChar = (char: string) => {
		// Ctrl+C
		if (char === '\x03') {
			if (shellMode) {
				shellMode = false;
				buffer = '';
				historyIndex = -1;
				needsPrompt = true;
				process.stdout.write('\n');
			} else {
				buffer = '';
				historyIndex = -1;
				process.stdout.write('\n');
				actions.quit();
			}

			return;
		}

		// Backspace
		if (char === '\x7f' || char === '\b') {
			if (buffer.length > 0) {
				renderLine(buffer.slice(0, -1));
			}

			return;
		}

		// Enter
		if (char === '\r' || char === '\n') {
			process.stdout.write('\n');
			const line = buffer;
			buffer = '';
			historyIndex = -1;

			if (line.trim().length > 0) {
				history.push(line);
			}

			if (shellMode) {
				handleShellLine(line);
			} else {
				handleLine(line);
			}

			return;
		}

		// Ignore other control characters
		if (char.charCodeAt(0) < 32) {
			return;
		}

		// Lazy prompt: first visible char after an action
		// renders on whatever line the cursor is now on
		if (needsPrompt) {
			process.stdout.write('\n');
		}
		renderLine(buffer + char);
	};

	const onData = (data: Buffer) => {
		const str = data.toString();

		for (let idx = 0; idx < str.length; idx++) {
			const char = str.charAt(idx);

			// Collecting escape sequence across data events
			if (escapeSeq.length > 0) {
				escapeSeq += char;

				// Got ESC + next char: must be '[' or bail
				if (escapeSeq.length === 2) {
					if (char !== '[') {
						escapeSeq = '';
					}

					continue;
				}

				// Got ESC [ X: handle arrow and reset
				if (escapeSeq.length === 3) {
					handleArrow(char);
					escapeSeq = '';

					continue;
				}

				continue;
			}

			// Start of escape sequence
			if (char === '\x1b') {
				escapeSeq = '\x1b';

				continue;
			}

			handleChar(char);
		}
	};

	const ttyStream = openTtyStream();
	const input = ttyStream ?? process.stdin;

	input.resume();
	input.on('data', onData);

	const dispose = () => {
		input.removeListener('data', onData);
		if (ttyStream) {
			try {
				ttyStream.setRawMode(false);
			} catch {
				/* already closed */
			}
		}
		if (ttyStream && ttyStream !== (process.stdin as unknown)) {
			ttyStream.destroy();
		}
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
