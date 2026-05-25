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
	await build(outdir, configPath, args.includes('--profile'));
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
} else if (command === 'ls') {
	sendTelemetryEvent('cli:command', { command: 'ls' });
	const { runLs } = await import('./scripts/ls');
	await runLs(args);
} else if (command === 'ps') {
	sendTelemetryEvent('cli:command', { command: 'ps' });
	const { runPs } = await import('./scripts/ps');
	await runPs(args);
} else if (command === 'mem') {
	sendTelemetryEvent('cli:command', { command: 'mem' });
	const { runMem } = await import('./scripts/mem');
	await runMem(args);
} else if (command === 'generate' || command === 'g') {
	sendTelemetryEvent('cli:command', { command: 'generate' });
	const { runGenerate } = await import('./scripts/generate');
	await runGenerate(args);
} else if (command === 'add') {
	sendTelemetryEvent('cli:command', { command: 'add' });
	const { runAdd } = await import('./scripts/add');
	await runAdd(args);
} else if (command === 'analyze') {
	sendTelemetryEvent('cli:command', { command: 'analyze' });
	const { runAnalyze } = await import('./scripts/analyze');
	await runAnalyze(args);
} else if (command === 'api') {
	sendTelemetryEvent('cli:command', { command: 'api' });
	const { runApi } = await import('./scripts/api');
	await runApi(args);
} else if (command === 'remove') {
	sendTelemetryEvent('cli:command', { command: 'remove' });
	const { runRemove } = await import('./scripts/remove');
	await runRemove(args);
} else if (command === 'htmx') {
	sendTelemetryEvent('cli:command', { command: 'htmx' });
	const { runHtmx } = await import('./scripts/htmx');
	await runHtmx(args);
} else if (command === 'env') {
	sendTelemetryEvent('cli:command', { command: 'env' });
	const { runEnv } = await import('./scripts/env');
	await runEnv(args);
} else if (command === 'logs') {
	sendTelemetryEvent('cli:command', { command: 'logs' });
	const { runLogs } = await import('./scripts/logs');
	await runLogs(args);
} else if (command === 'doctor') {
	sendTelemetryEvent('cli:command', { command: 'doctor' });
	const { runDoctor } = await import('./scripts/doctor');
	await runDoctor(args);
} else if (command === 'routes') {
	sendTelemetryEvent('cli:command', { command: 'routes' });
	const { runRoutes } = await import('./scripts/routes');
	await runRoutes(args);
} else if (command === 'inspect') {
	sendTelemetryEvent('cli:command', { command: 'inspect' });
	const { runInspect } = await import('./scripts/inspect');
	await runInspect(args);
} else if (command === 'islands') {
	sendTelemetryEvent('cli:command', { command: 'islands' });
	const { runIslands } = await import('./scripts/islands');
	await runIslands(args);
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
	console.error(
		'  build [--outdir dir] [--profile] Build production assets'
	);
	console.error('  start [entry] [--outdir dir] Start production server');
	console.error(
		'  compile [entry] [--outdir dir] [--outfile path] Compile standalone executable'
	);
	console.error(
		'  config [--port n] Open the unified config UI (ESLint, tsconfig, Prettier)'
	);
	console.error(
		'  doctor [--fix] [--json] Diagnose the project (bun, config, framework dirs, env, port)'
	);
	console.error(
		'  env [--check] [--json] Report env vars the app reads (getEnv) and which are missing'
	);
	console.error(
		'  add <framework> [--no-install] Add a framework (deps, config, starter page)'
	);
	console.error(
		'  analyze [--save] [--json] Bundle size breakdown + diff vs a saved baseline'
	);
	console.error(
		'  api [--open] [--json] Show the API surface or open the OpenAPI UI (@elysiajs/openapi)'
	);
	console.error('  eslint        Run ESLint (cached)');
	console.error(
		'  generate <page|api|component> <name> [--framework <fw>] Scaffold a page, API plugin, or component'
	);
	console.error(
		'  htmx [version] Self-host htmx — report or install/upgrade the pinned copy'
	);
	console.error('  info          Print system info for bug reports');
	console.error(
		'  inspect [--json] Live request inspector for a running dev server'
	);
	console.error(
		'  islands [--sizes] [--json] List islands by framework, hydration, pages (cross-framework aware)'
	);
	console.error(
		'  remove <framework> [--prune] Remove a framework from config (keeps source)'
	);
	console.error(
		'  logs <name> [-f] [-n <lines>] Tail a running server\'s log by name'
	);
	console.error(
		'  ls [--sizes] [--budget <size>] [--json] List the project\'s pages by framework'
	);
	console.error(
		'  mem [--json] | mem diff <a> <b>  Memory report (RSS), or diff two heap snapshots'
	);
	console.error(
		'  ps [--watch] [--json] [--kill <pid|port>] [--kill-all] List/manage running servers'
	);
	console.error('  prettier      Run Prettier check (cached)');
	console.error(
		'  routes [--json] List every route (pages + API) of a running dev server'
	);
	console.error('  typecheck     Run type checkers for all frameworks');
	console.error('  telemetry     Manage anonymous telemetry');
	console.error(
		'  tunnel-relay  Run the public reverse-tunnel relay (for webhook dev)'
	);
	process.exit(1);
}
