import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* `absolute --help`, `absolute --version`, and rejecting a flag no command
 * reads.
 *
 * What was here before: `--help` and `--version` were treated as command
 * names, so `absolute --help` printed `Unknown command: --help`, sent the
 * whole usage list to STDERR and exited 1 — a help that fails, so
 * `absolute --help | less` showed nothing and a script checking the exit
 * code saw an error. `--version` printed no version at all, and nothing
 * else did either: `absolute info` reports the OS, Bun and the package
 * versions but is not what anyone types to answer "what am I running".
 *
 * And an unknown flag was ignored in silence. `absolute typecheck
 * --bogus-flag --config` ran the full typecheck and exited 0, including
 * the `--config` with no value after it.
 *
 * Why only SOME commands validate their flags: 25 of the 37 forward their
 * whole argument list to a script that parses it itself — `eslint` and
 * `prettier` pass theirs to the underlying tool, `db` and `mobile` have
 * their own subcommands and options. Validating those here would reject
 * arguments that work today, so they are listed as pass-through and left
 * alone. The 12 that do validate are the ones whose flags this dispatcher
 * reads in full, which includes every command a new user types first. */

/** Flags every command accepts, so a command's own list need not repeat
 *  them. `--config` was read by nine commands and documented by none. */
export const GLOBAL_FLAGS: Readonly<Record<string, 'boolean' | 'value'>> = {
	'--config': 'value',
	'--help': 'boolean',
	'-h': 'boolean'
};

/* The flags each validated command reads, taken from the dispatcher in
 * index.ts rather than from the help text, because the help text did not
 * mention `--config` at all. A command absent from here is pass-through:
 * its arguments belong to the script it hands them to. */
const COMMAND_FLAGS: Readonly<
	Record<string, Readonly<Record<string, 'boolean' | 'value'>>>
> = {
	analyze: {
		'--check': 'boolean',
		'--json': 'boolean',
		'--modules': 'boolean',
		'--outdir': 'value',
		'--save': 'boolean',
		'--treemap': 'value'
	},
	bench: {
		'--check': 'boolean',
		'--json': 'boolean',
		'--outdir': 'value',
		'--save': 'boolean'
	},
	build: { '--outdir': 'value', '--profile': 'boolean' },
	compile: { '--outdir': 'value', '--outfile': 'value' },
	dev: {
		'--android-device': 'value',
		'--eager': 'boolean',
		'--ios-device': 'value',
		'--no-mobile': 'boolean'
	},
	export: {
		'--flat': 'boolean',
		'--json': 'boolean',
		'--outdir': 'value',
		'--precompressed': 'boolean',
		'--to': 'value'
	},
	info: {},
	links: {},
	migrate: {
		'--apply': 'boolean',
		'--check': 'boolean',
		'--json': 'boolean',
		'--path': 'value',
		'--target': 'value'
	},
	mkcert: {},
	prepare: { '--outdir': 'value' },
	start: { '--outdir': 'value', '--prebuilt': 'boolean' },
	'tunnel-relay': {},
	typecheck: {},
	upgrade: { '--dry-run': 'boolean', '--to': 'value', '--yes': 'boolean' },
	workspace: { '--no-tui': 'boolean' }
};

export const HELP_FLAGS = new Set(['--help', '-h', 'help']);
export const VERSION_FLAGS = new Set(['--version', '-v']);

/** Whether this command's flags are checked. False for a command that
 *  forwards its arguments to something else. */
export const validatesFlags = (command: string) =>
	Object.hasOwn(COMMAND_FLAGS, command);

/** Distance below which a flag reads as a typo of a known one rather
 *  than a different intention. */
const MINIMUM_TYPO_DISTANCE = 2;
const TYPO_LENGTH_DIVISOR = 3;

const nextRow = (
	left: string,
	right: string,
	previous: readonly number[],
	rowIndex: number
) => {
	const row = [rowIndex + 1];
	for (const [colIndex, char] of [...right].entries()) {
		const cost = left[rowIndex] === char ? 0 : 1;
		row.push(
			Math.min(
				(row[colIndex] ?? 0) + 1,
				(previous[colIndex + 1] ?? 0) + 1,
				(previous[colIndex] ?? 0) + cost
			)
		);
	}

	return row;
};

const levenshtein = (left: string, right: string) => {
	let previous: readonly number[] = Array.from(
		{ length: right.length + 1 },
		(_, index) => index
	);
	for (const rowIndex of [...left].keys())
		previous = nextRow(left, right, previous, rowIndex);

	return previous[right.length] ?? right.length;
};

/** The closest known flag, when one is close enough to be a typo. */
const nearest = (flag: string, known: readonly string[]) => {
	const scored = known
		.map((candidate) => ({
			candidate,
			distance: levenshtein(flag, candidate)
		}))
		.sort((left, right) => left.distance - right.distance);
	const [best] = scored;
	const limit = Math.max(
		MINIMUM_TYPO_DISTANCE,
		Math.floor(flag.length / TYPO_LENGTH_DIVISOR)
	);

	return best && best.distance <= limit ? best.candidate : undefined;
};

export type FlagProblem = { message: string };

const problemFor = (
	command: string,
	flag: string,
	value: string | undefined,
	known: Readonly<Record<string, 'boolean' | 'value'>>
) => {
	const kind = known[flag];
	if (kind === undefined) {
		const suggestion = nearest(flag, Object.keys(known));
		const unknown: FlagProblem = {
			message: `Unknown flag for \`absolute ${command}\`: ${flag}${suggestion ? `. Did you mean ${suggestion}?` : ''}`
		};

		return unknown;
	}
	/* A value flag whose value is missing, or is itself a flag. The
	 * dispatcher read `args[idx + 1]` and got `undefined`, which every
	 * caller treated as "not given" — so `--config` at the end of the line
	 * silently used the default config. */
	if (kind !== 'value') return null;
	if (value !== undefined && !value.startsWith('-')) return null;
	const missing: FlagProblem = {
		message: `${flag} needs a value after it.`
	};

	return missing;
};

/** The first thing wrong with this command's flags, or null.
 *
 *  Reports an unknown flag and a flag that needs a value and did not get
 *  one. A positional argument is not checked here: `dev [entry]` and
 *  `db <backup|restore|seed>` take them, and which ones are valid is the
 *  command's own business. */
export const validateCommandFlags = (
	command: string,
	args: readonly string[]
) => {
	const own = COMMAND_FLAGS[command];
	if (!own) return null;
	const known: Readonly<Record<string, 'boolean' | 'value'>> = {
		...GLOBAL_FLAGS,
		...own
	};
	for (const [index, arg] of args.entries()) {
		if (!arg.startsWith('-')) continue;
		const problem = problemFor(command, arg, args[index + 1], known);
		if (problem) return problem;
	}

	return null;
};

const readPackageVersion = (candidate: string) => {
	if (!existsSync(candidate)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf-8'));
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			!('name' in parsed) ||
			parsed.name !== '@absolutejs/absolute' ||
			!('version' in parsed) ||
			typeof parsed.version !== 'string'
		)
			return undefined;

		return parsed.version;
	} catch {
		// Unreadable or not JSON.
		return undefined;
	}
};

/** The version of the installed `@absolutejs/absolute`, for `--version`.
 *
 *  Resolved from the package the CLI itself was loaded from, not from the
 *  project's `node_modules`, so the answer is the version that is running
 *  rather than one installed somewhere nearby. */
export const absoluteCliVersion = () => {
	const candidates = [
		resolve(import.meta.dir, '..', '..', 'package.json'),
		resolve(import.meta.dir, '..', '..', '..', 'package.json')
	];
	for (const candidate of candidates) {
		const version = readPackageVersion(candidate);
		if (version !== undefined) return version;
	}

	return undefined;
};
