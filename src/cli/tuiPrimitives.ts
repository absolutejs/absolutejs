import { openSync } from 'node:fs';
import { ReadStream } from 'node:tty';
import { ANSI_ESCAPE_CODE } from '../constants';
import type { TuiColors } from '../../types/cli';

// Pure terminal helpers shared by the interactive CLI dashboards
// (`workspaceTui`, `listTui`): ANSI handling, fixed-width padding/wrapping,
// raw-mode TTY acquisition, and escape-sequence classification.

const ANSI_REGEX = new RegExp(
	`${String.fromCharCode(ANSI_ESCAPE_CODE)}\\[[0-?]*[ -/]*[@-~]`,
	'g'
);

const trySetRawMode = () => {
	if (typeof process.stdin.setRawMode !== 'function') {
		return null;
	}

	try {
		process.stdin.setRawMode(true);
	} catch {
		return null;
	}

	return process.stdin;
};

const splitLongWord = (word: string, width: number) => {
	const parts: string[] = [];
	for (let index = 0; index < word.length; index += width) {
		parts.push(word.slice(index, index + width));
	}

	return parts;
};

const appendWrappedWord = (
	lines: string[],
	current: string,
	word: string,
	width: number
) => {
	if (current.length === 0) {
		if (word.length <= width) return word;
		lines.push(...splitLongWord(word, width));

		return '';
	}

	const next = `${current} ${word}`;
	if (next.length <= width) return next;

	lines.push(current);
	if (word.length <= width) return word;
	lines.push(...splitLongWord(word, width));

	return '';
};

const wrapLine = (line: string, width: number) => {
	if (line.length === 0) return [''];
	if (line.length <= width) return [line];

	const lines: string[] = [];
	let current = '';
	for (const word of line.split(/\s+/)) {
		current = appendWrappedWord(lines, current, word, width);
	}
	if (current.length > 0) lines.push(current);

	return lines;
};

export const ANSI_ESCAPE_PREFIX = '\x1b[';

export const colors: TuiColors = {
	bold: '\x1b[1m',
	cyan: '\x1b[36m',
	dim: '\x1b[2m',
	green: '\x1b[32m',
	red: '\x1b[31m',
	reset: '\x1b[0m',
	yellow: '\x1b[33m'
};

export const ESCAPE = '\x1b';

export const appendRightEdge = (
	value: string,
	width: number,
	marker: string
) => {
	if (width <= 0) {
		return '';
	}

	return `${padLine(value, Math.max(0, width - 1))}${marker}`;
};

export const formatTimestamp = () =>
	new Date().toLocaleTimeString([], {
		hour: 'numeric',
		hour12: true,
		minute: '2-digit',
		second: '2-digit'
	});

export const isPartialEscapeSequence = (value: string) => {
	if (!value.startsWith(ANSI_ESCAPE_PREFIX)) {
		return false;
	}

	return Array.from(value.slice(ANSI_ESCAPE_PREFIX.length)).every(
		(char) => char >= '0' && char <= '9'
	);
};

export const openTtyStream = () => {
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

export const padLine = (value: string, width: number) => {
	const plainLength = visibleLength(value);
	if (plainLength >= width) {
		return value;
	}

	return `${value}${' '.repeat(width - plainLength)}`;
};

export const stripAnsi = (value: string) => value.replace(ANSI_REGEX, '');

export const truncateText = (value: string, width: number) => {
	if (width <= 0) {
		return '';
	}
	if (value.length <= width) {
		return value;
	}
	if (width <= 1) {
		return value.slice(0, width);
	}

	return `${value.slice(0, width - 1)}…`;
};

export const visibleLength = (value: string) =>
	value.replace(ANSI_REGEX, '').length;

export const wrapText = (value: string, width: number) => {
	if (width <= 0) {
		return [''];
	}

	const lines = value
		.split('\n')
		.flatMap((rawLine) => wrapLine(rawLine.trimEnd(), width));

	return lines.length > 0 ? lines : [''];
};
