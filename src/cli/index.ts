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

const startDatabase = async (scripts: DbScripts) => {
	console.log('Starting database container...');
	const { exitCode } = await Bun.$`${{ raw: scripts.upCommand }}`.nothrow();
	if (exitCode !== 0) process.exit(exitCode);
};

const stopDatabase = async (scripts: DbScripts) => {
	console.log('\nStopping database container...');
	await Bun.$`${{ raw: scripts.downCommand }}`.quiet().nothrow();
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

	const cleanup = async (exitCode = 0) => {
		if (cleaning) return;
		cleaning = true;
		try {
			server.kill();
		} catch (err) {
			console.error('Failed to kill server process:', err);
		}
		await server.exited;
		if (scripts) await stopDatabase(scripts);
		process.exit(exitCode);
	};

	process.on('SIGINT', () => cleanup(0));
	process.on('SIGTERM', () => cleanup(0));

	await server.exited;
	await cleanup(0);
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
