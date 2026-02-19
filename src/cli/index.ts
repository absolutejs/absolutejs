#!/usr/bin/env bun

import { dev } from './scripts/dev';
import { DEFAULT_SERVER_ENTRY } from './utils';

const command = process.argv[2];

if (command === 'dev') {
	const serverEntry = process.argv[3] ?? DEFAULT_SERVER_ENTRY;
	await dev(serverEntry);
} else {
	const message = command
		? `Unknown command: ${command}`
		: 'No command specified';
	console.error(message);
	console.error('Usage: absolutejs <command>');
	console.error('Commands:');
	console.error('  dev [entry]  Start development server');
	process.exit(1);
}
