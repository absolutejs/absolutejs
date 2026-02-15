#!/usr/bin/env bun

import { $ } from 'bun';
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

const timed = async (label: string, fn: () => Promise<void>) => {
	process.stdout.write(label);
	const start = performance.now();
	await fn();
	const duration = ((performance.now() - start) / 1000).toFixed(2);
	process.stdout.write(` \x1b[90m${duration}s\x1b[0m\n`);
};

const startDatabase = async (scripts: DbScripts) => {
	await timed('Starting database container...', async () => {
		const { exitCode } = await $`${{ raw: scripts.upCommand }}`
			.quiet()
			.nothrow();
		if (exitCode !== 0) process.exit(exitCode);
	});
};

const stopDatabase = async (scripts: DbScripts) => {
	process.stdout.write('\n');
	await timed('Stopping database container...', async () => {
		await $`${{ raw: scripts.downCommand }}`.quiet().nothrow();
	});
};

const dev = async (serverEntry: string) => {
	const usesDocker = existsSync(resolve(COMPOSE_PATH));
	const scripts = usesDocker ? await readDbScripts() : null;

	if (scripts) await startDatabase(scripts);

	const spawnServer = () =>
		Bun.spawn(['bun', '--hot', serverEntry], {
			cwd: process.cwd(),
			env: {
				...process.env,
				ABSOLUTEJS_SERVER_ENTRY: resolve(process.cwd(), serverEntry)
			},
			stdin: 'inherit',
			stdout: 'inherit',
			stderr: 'inherit'
		});

	let serverProcess = spawnServer();
	let cleaning = false;

	const cleanup = async (exitCode = 0) => {
		if (cleaning) return;
		cleaning = true;
		try {
			serverProcess.kill();
		} catch {
			/* process already exited */
		}
		await serverProcess.exited;
		if (scripts) await stopDatabase(scripts);
		process.exit(exitCode);
	};

	process.on('SIGINT', () => cleanup(0));
	process.on('SIGTERM', () => cleanup(0));

	const monitorServer = async () => {
		while (!cleaning) {
			const exitCode = await serverProcess.exited;
			if (cleaning) continue;
			// Exit codes 130 (SIGINT) and 143 (SIGTERM) mean the child was
			// killed by a signal — treat as intentional shutdown, not a crash.
			if (exitCode === 130 || exitCode === 143) {
				await cleanup(0);
				return;
			}
			console.error(
				`\x1b[31m[cli] Server exited (code ${exitCode}), restarting...\x1b[0m`
			);
			serverProcess = spawnServer();
		}
	};

	await monitorServer();
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
