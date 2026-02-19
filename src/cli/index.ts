#!/usr/bin/env bun

import { dev } from './scripts/dev';
import { eslint } from './scripts/eslint';
import { prettier } from './scripts/prettier';
import { DEFAULT_SERVER_ENTRY } from './utils';

const command = process.argv[2];
const args = process.argv.slice(3);

if (command === 'dev') {
	const serverEntry = args[0] ?? DEFAULT_SERVER_ENTRY;
	await dev(serverEntry);
} else if (command === 'eslint') {
	await eslint(args);
} else if (command === 'prettier') {
	await prettier(args);
} else {
	const message = command
		? `Unknown command: ${command}`
		: 'No command specified';
	console.error(message);
	console.error('Usage: absolutejs <command>');
	console.error('Commands:');
	console.error('  dev [entry]   Start development server');
	console.error('  eslint        Run ESLint (cached)');
	console.error('  prettier      Run Prettier check (cached)');
	process.exit(1);
}
