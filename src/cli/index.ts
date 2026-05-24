#!/usr/bin/env bun

import { dev } from './scripts/dev';
import { eslint } from './scripts/eslint';
import { info } from './scripts/info';
import { prettier } from './scripts/prettier';
import { start } from './scripts/start';
import { workspace } from './scripts/workspace';
import { telemetry } from './scripts/telemetry';
import { sendTelemetryEvent } from './telemetryEvent';
import {
	CLI_ARGS_OFFSET,
	UNFOUND_INDEX,
	WORKSPACE_COMMAND_ARGS_OFFSET
} from '../constants';
import { DEFAULT_SERVER_ENTRY } from './utils';

const [command] = process.argv.slice(2);
const [workspaceCommand] = process.argv.slice(WORKSPACE_COMMAND_ARGS_OFFSET);
const args = process.argv.slice(CLI_ARGS_OFFSET);

const parseNamedArg = (flag: string) => {
	const idx = args.indexOf(flag);
	if (idx === UNFOUND_INDEX) return undefined;

	return args[idx + 1];
};

const stripNamedArgs = (...flags: string[]) =>
	args.filter((_, idx) =>
		flags.every((flag) => {
			const flagIdx = args.indexOf(flag);
			if (flagIdx === UNFOUND_INDEX) return true;

			return idx !== flagIdx && idx !== flagIdx + 1;
		})
	);

if (command === 'dev') {
	sendTelemetryEvent('cli:command', { command });
	const configPath = parseNamedArg('--config');
	const positionalArgs = stripNamedArgs('--config');
	const serverEntry = positionalArgs[0] ?? DEFAULT_SERVER_ENTRY;
	await dev(serverEntry, configPath);
} else if (command === 'start') {
	sendTelemetryEvent('cli:command', { command });
	const outdir = parseNamedArg('--outdir');
	const configPath = parseNamedArg('--config');
	const positionalArgs = stripNamedArgs('--outdir', '--config');
	const serverEntry = positionalArgs[0] ?? DEFAULT_SERVER_ENTRY;
	await start(serverEntry, outdir, configPath);
} else if (command === 'build') {
	sendTelemetryEvent('cli:command', { command });
	const outdir = parseNamedArg('--outdir');
	const configPath = parseNamedArg('--config');
	const { build } = await import('./scripts/build');
	await build(outdir, configPath);
} else if (command === 'workspace') {
	sendTelemetryEvent('cli:command', {
		command: `workspace:${workspaceCommand ?? 'unknown'}`
	});
	const configPath = parseNamedArg('--config');
	await workspace(workspaceCommand, {
		configPath,
		noTui: args.includes('--no-tui')
	});
} else if (command === 'config') {
	sendTelemetryEvent('cli:command', { command: 'config' });
	// Resolved at runtime (not a static literal) so the bundler keeps the
	// React-carrying config server out of the lean main CLI chunk. Resolves
	// to `config/server.ts` from source and `config/server.js` from dist.
	const configServerModule = `${import.meta.dir}/config/server`;
	const { launchConfig } = await import(configServerModule);
	await launchConfig(args);
} else if (command === 'eslint') {
	sendTelemetryEvent('cli:command', { command });
	await eslint(args);
} else if (command === 'prettier') {
	sendTelemetryEvent('cli:command', { command });
	await prettier(args);
} else if (command === 'ls' || command === 'ps') {
	sendTelemetryEvent('cli:command', { command: 'ls' });
	const { runList } = await import('./scripts/list');
	await runList(args);
} else if (command === 'info') {
	sendTelemetryEvent('cli:command', { command });
	info();
} else if (command === 'telemetry') {
	sendTelemetryEvent('cli:command', { command });
	telemetry(args);
} else if (command === 'compile') {
	sendTelemetryEvent('cli:command', { command });
	const outdir = parseNamedArg('--outdir');
	const outfile = parseNamedArg('--outfile');
	const configPath = parseNamedArg('--config');
	const positionalArgs = stripNamedArgs('--outdir', '--outfile', '--config');
	const serverEntry = positionalArgs[0] ?? DEFAULT_SERVER_ENTRY;
	const { compile } = await import('./scripts/compile');
	await compile(serverEntry, outdir, outfile, configPath);
} else if (command === 'typecheck') {
	sendTelemetryEvent('cli:command', { command });
	const configPath = parseNamedArg('--config');
	const { typecheck } = await import('./scripts/typecheck');
	await typecheck(configPath);
} else if (command === 'mkcert') {
	sendTelemetryEvent('cli:command', { command });
	const { setupMkcert } = await import('../dev/devCert');
	setupMkcert();
} else if (command === 'tunnel-relay') {
	sendTelemetryEvent('cli:command', { command });
	const { tunnelRelay } = await import('./scripts/tunnelRelay');
	tunnelRelay();
} else {
	const message = command
		? `Unknown command: ${command}`
		: 'No command specified';
	console.error(message);
	console.error('Usage: absolute <command>');
	console.error('Commands:');
	console.error('  dev [entry]   Start development server');
	console.error(
		'  workspace dev [--no-tui] Start multi-service workspace dev'
	);
	console.error('  build [--outdir dir] Build production assets');
	console.error('  start [entry] [--outdir dir] Start production server');
	console.error(
		'  compile [entry] [--outdir dir] [--outfile path] Compile standalone executable'
	);
	console.error(
		'  config [--port n] Open the unified config UI (ESLint, tsconfig, Prettier)'
	);
	console.error('  eslint        Run ESLint (cached)');
	console.error('  info          Print system info for bug reports');
	console.error(
		'  ls [--watch] [--json] List/manage running servers (alias: ps)'
	);
	console.error('  prettier      Run Prettier check (cached)');
	console.error('  typecheck     Run type checkers for all frameworks');
	console.error('  telemetry     Manage anonymous telemetry');
	console.error(
		'  tunnel-relay  Run the public reverse-tunnel relay (for webhook dev)'
	);
	process.exit(1);
}
