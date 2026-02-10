#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const COMPOSE_PATH = 'db/docker-compose.db.yml';
const DEFAULT_SERVER_ENTRY = 'src/backend/server.ts';

interface DbScripts {
	upCommand: string;
	downCommand: string;
}

const readDbScripts = async () => {
	const pkgPath = resolve('package.json');
	if (!existsSync(pkgPath)) return null;

	const pkg = await Bun.file(pkgPath).json();
	const upCommand: string | undefined = pkg.scripts?.['db:up'];
	const downCommand: string | undefined = pkg.scripts?.['db:down'];

	if (!upCommand || !downCommand) return null;
	return { upCommand, downCommand };
};

const execCommand = async (command: string) => {
	const args = command.split(' ');
	const proc = Bun.spawn(args, {
		stdin: 'inherit',
		stdout: 'inherit',
		stderr: 'inherit'
	});
	return proc.exited;
};

const startDatabase = async (scripts: DbScripts) => {
	console.log('Starting database container...');
	const exitCode = await execCommand(scripts.upCommand);
	if (exitCode !== 0) process.exit(exitCode);
};

const stopDatabase = async (scripts: DbScripts) => {
	console.log('\nStopping database container...');
	try {
		await execCommand(scripts.downCommand);
	} catch {
		console.error('Failed to stop database container');
	}
};

const dev = async (serverEntry: string) => {
	const usesDocker = existsSync(resolve(COMPOSE_PATH));
	const scripts = usesDocker ? await readDbScripts() : null;

	if (scripts) await startDatabase(scripts);

	const server = Bun.spawn(['bun', '--watch', serverEntry], {
		stdin: 'inherit',
		stdout: 'inherit',
		stderr: 'inherit'
	});

	let cleaning = false;

	const cleanup = async () => {
		if (cleaning) return;
		cleaning = true;
		server.kill();
		await server.exited;
		if (scripts) await stopDatabase(scripts);
		process.exit(0);
	};

	process.on('SIGINT', cleanup);
	process.on('SIGTERM', cleanup);

	const exitCode = await server.exited;

	if (!cleaning && scripts) await stopDatabase(scripts);
	if (!cleaning) process.exit(exitCode);
};

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
