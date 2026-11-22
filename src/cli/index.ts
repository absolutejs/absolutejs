#!/usr/bin/env bun

import { sendTelemetryEvent } from './telemetryEvent';
import {
	CLI_ARGS_OFFSET,
	UNFOUND_INDEX,
	WORKSPACE_COMMAND_ARGS_OFFSET
} from '../constants';
import { DEFAULT_SERVER_ENTRY } from './utils';
import {
	absoluteCliVersion,
	HELP_FLAGS,
	validateCommandFlags,
	validatesFlags,
	VERSION_FLAGS
} from './usage';
import { markBoot } from '../utils/bootTimeline';

// First statement of the CLI bundle's body: everything before it (Bun's own
// startup plus parsing/evaluating this bundle) is the gap between the boot
// origin and this mark.
markBoot('cli imports evaluated');

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

const printUsage = (write: (line: string) => void) => {
	write('Usage: absolute <command>');
	write('Commands:');
	write(
		'  dev [entry] [--eager] [--no-mobile] [--android-device serial] [--ios-device identifier] Start web and configured mobile development (--eager builds every page at boot instead of on first request)'
	);
	write('  workspace dev [--no-tui] Start multi-service workspace dev');
	write('  build [--outdir dir] [--profile] Build production assets');
	write(
		'  prepare [entry] [--outdir dir] Build production assets and server without launching'
	);
	write(
		'  start [entry] [--outdir dir] [--prebuilt] Start production server'
	);
	write(
		'  compile [entry] [--outdir dir] [--outfile path] Compile standalone executable'
	);
	write(
		'  mobile <init|sync|assets|inspect|ci|pair|remotes|doctor|test> Manage Capacitor apps and the experimental Expo hybrid shell'
	);
	write(
		'  config [--port n] Open the unified config UI (ESLint, tsconfig, Prettier)'
	);
	write(
		'  db <backup|restore|seed> Backup/restore (ORM-agnostic JSON, upsert by PK) PostgreSQL, CockroachDB, MySQL, MariaDB, SingleStore, SQLite, libSQL/Turso or SQL Server, or run the seed script'
	);
	write(
		'  doctor [--fix] [--json] Diagnose the project (bun, type graph, config, framework dirs, env, port)'
	);
	write(
		'  env [--check] [--json] Report env vars the app reads (getEnv) and which are missing'
	);
	write(
		'  add <framework> [--no-install] Add a framework (deps, config, starter page)'
	);
	write(
		'  analyze [--save] [--json] Bundle size breakdown + diff vs a saved baseline'
	);
	write(
		'  api [--open] [--json] Show the API surface or open the OpenAPI UI (@elysia/openapi)'
	);
	write('  eslint        Run ESLint (cached)');
	write(
		'  lint-proof <run|verify> -- <command> Record or verify an exact-source local lint pass'
	);
	write(
		'  generate <page|api|component> <name> [--framework <fw>] Scaffold a page, API plugin, or component'
	);
	write(
		'  htmx [version] Self-host htmx — report or install/upgrade the pinned copy'
	);
	write('  info          Print system info for bug reports');
	write('  inspect [--json] Live request inspector for a running dev server');
	write(
		'  islands [--sizes] [--json] List islands by framework, hydration, pages (cross-framework aware)'
	);
	write(
		'  remove <framework> [--prune] Remove a framework from config (keeps source)'
	);
	write(
		"  logs <name> [-f] [-n <lines>] Tail a running server's log by name"
	);
	write(
		"  ls [--sizes] [--budget <size>] [--json] List the project's pages by framework"
	);
	write(
		'  mem [--json] | mem diff <a> <b>  Memory report (RSS), or diff two heap snapshots'
	);
	write(
		'  ps [--watch] [--json] [--kill <pid|port>] [--kill-all] List/manage running servers'
	);
	write(
		'  fmt [--check] Format with bun fmt (Bun 1.4.4+; reads your Prettier config)'
	);
	write('  prettier      Run Prettier check (cached)');
	write(
		'  routes [--json] List every route (pages + API) of a running dev server'
	);
	write('  typecheck     Run type checkers for all frameworks');
	write(
		'  links [--config path] Report literal <a href="/…"> links no route serves (exits 1 on findings)'
	);
	write(
		'  upgrade [--to version] [--dry-run] Apply the migrations between the installed version and a newer one, and list the ones a person has to make'
	);
	write(
		'  migrate       Report what moving this project to AbsoluteJS involves'
	);
	write(
		'  bun-patch [status|install|remove|reset] Bun with the React Fast Refresh fix (oven-sh/bun#32919)'
	);
	write('  telemetry     Manage anonymous telemetry');
	write(
		'  tunnel-relay  Run the public reverse-tunnel relay (for webhook dev)'
	);
	/* Named here because nine commands read `--config` and the lines above
	 * mention it on only some of them, which made an accepted flag look
	 * like an unknown one. */
	write('');
	write('Global flags:');
	write('  --config <path> Use this config instead of ./absolute.config.ts');
	write('  --help, -h      Print this list');
	write('  --version, -v   Print the installed @absolutejs/absolute version');
};

/* Help and version first, so neither is treated as a command name. Both
 * answer on STDOUT and exit 0: `absolute --help` used to print
 * `Unknown command: --help`, send the list to stderr and exit 1. */
if (command !== undefined && HELP_FLAGS.has(command)) {
	printUsage(console.log);
	process.exit(0);
}
if (command !== undefined && VERSION_FLAGS.has(command)) {
	const version = absoluteCliVersion();
	if (version === undefined) {
		console.error('Could not read the version of @absolutejs/absolute.');
		process.exit(1);
	}
	console.log(version);
	process.exit(0);
}
/* `absolute <command> --help` is the command's own help request, not an
 * argument for it to parse. */
if (command !== undefined && args.some((arg) => HELP_FLAGS.has(arg))) {
	printUsage(console.log);
	process.exit(0);
}
/* A flag no command reads was ignored in silence, and so was a flag whose
 * value was missing. Only commands whose flags this file reads in full are
 * checked — see usage.ts for why the other 25 are not. */
if (command !== undefined && validatesFlags(command)) {
	const problem = validateCommandFlags(command, args);
	if (problem) {
		console.error(problem.message);
		console.error(`Run \`absolute --help\` for the list of commands.`);
		process.exit(1);
	}
}

if (command === 'dev') {
	sendTelemetryEvent('cli:command', { command });
	const configPath = parseNamedArg('--config');
	const androidDevice = parseNamedArg('--android-device');
	const iosDevice = parseNamedArg('--ios-device');
	if (args.includes('--android-device') && !androidDevice) {
		throw new TypeError('--android-device requires an ADB device serial.');
	}
	if (androidDevice && args.includes('--no-mobile')) {
		throw new TypeError(
			'--android-device cannot be combined with --no-mobile.'
		);
	}
	if (args.includes('--ios-device') && !iosDevice) {
		throw new TypeError(
			'--ios-device requires an Xcode device identifier or name.'
		);
	}
	if (iosDevice && args.includes('--no-mobile')) {
		throw new TypeError(
			'--ios-device cannot be combined with --no-mobile.'
		);
	}
	const positionalArgs = stripNamedArgs(
		'--config',
		'--android-device',
		'--ios-device'
	).filter((arg) => arg !== '--no-mobile' && arg !== '--eager');
	const serverEntry = positionalArgs[0] ?? DEFAULT_SERVER_ENTRY;
	const { dev } = await import('./scripts/dev');
	await dev(serverEntry, configPath, {
		androidDevice,
		eager: args.includes('--eager'),
		iosDevice,
		mobile: !args.includes('--no-mobile')
	});
} else if (command === 'bun-patch') {
	// BUN-REACT-REFRESH-LEGACY: manages AbsoluteJS's patched Bun (./patchedBun.ts).
	const { bunPatch } = await import('./patchedBun');
	bunPatch(args);
} else if (command === 'start') {
	sendTelemetryEvent('cli:command', { command });
	const outdir = parseNamedArg('--outdir');
	const configPath = parseNamedArg('--config');
	const positionalArgs = stripNamedArgs('--outdir', '--config').filter(
		(arg) => arg !== '--prebuilt'
	);
	const serverEntry = positionalArgs[0] ?? DEFAULT_SERVER_ENTRY;
	const { start } = await import('./scripts/start');
	await start(serverEntry, outdir, configPath, {
		prebuilt: args.includes('--prebuilt')
	});
} else if (command === 'prepare') {
	sendTelemetryEvent('cli:command', { command });
	const outdir = parseNamedArg('--outdir');
	const configPath = parseNamedArg('--config');
	const positionalArgs = stripNamedArgs('--outdir', '--config');
	const serverEntry = positionalArgs[0] ?? DEFAULT_SERVER_ENTRY;
	const { start } = await import('./scripts/start');
	await start(serverEntry, outdir, configPath, { prepareOnly: true });
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
	const { workspace } = await import('./scripts/workspace');
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
	const { eslint } = await import('./scripts/eslint');
	await eslint(args);
} else if (command === 'lint-proof') {
	sendTelemetryEvent('cli:command', { command });
	const { runLintProof } = await import('./scripts/lintProof');
	process.exitCode = await runLintProof(args);
} else if (command === 'fmt') {
	sendTelemetryEvent('cli:command', { command });
	const { fmt } = await import('./scripts/fmt');
	await fmt(args);
} else if (command === 'prettier') {
	sendTelemetryEvent('cli:command', { command });
	const { prettier } = await import('./scripts/prettier');
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
} else if (command === 'db') {
	sendTelemetryEvent('cli:command', {
		command: `db:${workspaceCommand ?? 'unknown'}`
	});
	const { runDb } = await import('./scripts/db');
	try {
		await runDb(args);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
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
	const { info } = await import('./scripts/info');
	info();
} else if (command === 'telemetry') {
	sendTelemetryEvent('cli:command', { command });
	const { telemetry } = await import('./scripts/telemetry');
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
} else if (command === 'mobile') {
	sendTelemetryEvent('cli:command', {
		command: `mobile:${workspaceCommand ?? 'unknown'}`
	});
	const { runMobile } = await import('./scripts/mobile');
	try {
		await runMobile(args);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
} else if (command === 'i18n') {
	sendTelemetryEvent('cli:command', { command });
	const [subcommand, ...rest] = args;
	if (subcommand !== 'check') {
		console.error(
			'Usage: absolute i18n check <default-catalog> [locale-catalog…] [--json]'
		);
		process.exit(1);
	}
	const { i18nCheck } = await import('./scripts/i18nCheck');
	await i18nCheck(rest);
} else if (command === 'typecheck') {
	sendTelemetryEvent('cli:command', { command });
	const configPath = parseNamedArg('--config');
	const { typecheck } = await import('./scripts/typecheck');
	await typecheck(configPath);
} else if (command === 'upgrade') {
	sendTelemetryEvent('cli:command', { command });
	const { upgrade } = await import('./scripts/upgrade');
	await upgrade(args);
} else if (command === 'links') {
	sendTelemetryEvent('cli:command', { command });
	const { links } = await import('./scripts/links');
	await links(parseNamedArg('--config'));
} else if (command === 'migrate') {
	sendTelemetryEvent('cli:command', { command });
	const { migrate } = await import('./scripts/migrate');
	migrate(parseNamedArg('--path'));
} else if (command === 'mkcert') {
	sendTelemetryEvent('cli:command', { command });
	const { setupMkcert } = await import('../dev/devCert');
	setupMkcert();
} else if (command === 'tunnel-relay') {
	sendTelemetryEvent('cli:command', { command });
	const { tunnelRelay } = await import('./scripts/tunnelRelay');
	tunnelRelay();
} else {
	/* An unknown command still reports on stderr and exits 1; an explicit
	 * help request goes to stdout and exits 0, and is handled before the
	 * dispatch above ever sees it. */
	console.error(
		command ? `Unknown command: ${command}` : 'No command specified'
	);
	printUsage(console.error);
	process.exit(1);
}
