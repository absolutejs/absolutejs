#!/usr/bin/env bun

import { dev } from './scripts/dev';
import { eslint } from './scripts/eslint';
import { info } from './scripts/info';
import { prettier } from './scripts/prettier';
import { telemetry } from './scripts/telemetry';
import { sendTelemetryEvent } from './telemetryEvent';
import { DEFAULT_SERVER_ENTRY } from './utils';

const command = process.argv[2];
const args = process.argv.slice(3);

if (command === 'dev') {
	sendTelemetryEvent('cli:command', { command });
	const serverEntry = args[0] ?? DEFAULT_SERVER_ENTRY;
	await dev(serverEntry);
} else if (command === 'eslint') {
	sendTelemetryEvent('cli:command', { command });
	await eslint(args);
} else if (command === 'prettier') {
	sendTelemetryEvent('cli:command', { command });
	await prettier(args);
} else if (command === 'info') {
	sendTelemetryEvent('cli:command', { command });
	info();
} else if (command === 'telemetry') {
	sendTelemetryEvent('cli:command', { command });
	telemetry(args);
} else {
	const message = command
		? `Unknown command: ${command}`
		: 'No command specified';
	console.error(message);
	console.error('Usage: absolute <command>');
	console.error('Commands:');
	console.error('  dev [entry]   Start development server');
	console.error('  eslint        Run ESLint (cached)');
	console.error('  info          Print system info for bug reports');
	console.error('  prettier      Run Prettier check (cached)');
	console.error('  telemetry     Manage anonymous telemetry');
	process.exit(1);
}
