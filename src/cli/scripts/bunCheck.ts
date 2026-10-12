import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';
import { isRecord } from '../config/guards';

/* `bun check` (Bun 1.4.3) is a port of TypeScript 7's checker that reads the
 * same tsconfig.json and reports the same errors as tsc. On this repository
 * it checks 1,183 files in 2.6s and 0.47 GB, where tsc 5.9 took 38.6s and
 * 1.5 GB. It only checks: it never writes, and so keeps no .tsbuildinfo. */
export const BUN_CHECK_MIN_VERSION = '1.4.3';

/** Set to `tsc` to keep the TypeScript compiler as the checker. */
export const CHECKER_ENV = 'ABSOLUTE_TYPECHECK_CHECKER';
/** Caps the threads `bun check` starts: one per core by default, which a
 *  memory-capped container (Studio) cannot always afford. */
export const THREADS_ENV = 'ABSOLUTE_TYPECHECK_THREADS';

type Env = Record<string, string | undefined>;

export const bunCheckCommand = (
	configPath: string,
	env: Env = process.env,
	bun: string = process.execPath,
	terminal: boolean = process.stdout.isTTY === true
) => {
	const threads = Number(env[THREADS_ENV]);
	const command = [bun, 'check', '-p', configPath, '--all'];
	// Its output reaches the user through a pipe, which bun check would
	// otherwise read as CI: one plain line per error, no source excerpt.
	if (terminal) command.push('--pretty=true');
	if (Number.isSafeInteger(threads) && threads > 0)
		command.push(`--threads=${threads}`);

	return command;
};
export const bunCheckSupported = (
	version: string = Bun.version,
	env: Env = process.env
) =>
	env[CHECKER_ENV] !== 'tsc' &&
	Bun.semver.satisfies(version, `>=${BUN_CHECK_MIN_VERSION}`);

/* tsconfig `extends` can chain; every config in the chain shapes the check,
 * so each one is part of the fingerprint. Package specifiers resolve into
 * node_modules, whose files the listing already covers. */
const isFilePath = (specifier: string) =>
	specifier.startsWith('.') || specifier.startsWith('/');

const parentsOf = (config: string) => {
	let parsed: unknown;
	try {
		parsed = parseJsonc(readFileSync(config, 'utf-8'));
	} catch {
		return [];
	}
	const parents: unknown = isRecord(parsed) ? parsed.extends : undefined;
	const list = Array.isArray(parents) ? parents : [parents];

	return list
		.filter(
			(parent): parent is string =>
				typeof parent === 'string' && isFilePath(parent)
		)
		.map((parent) => resolve(dirname(config), parent));
};

const configChain = (start: string) => {
	const seen: string[] = [];
	const pending = [start];
	for (let next = pending.shift(); next; next = pending.shift()) {
		if (seen.includes(next) || !existsSync(next)) continue;
		seen.push(next);
		pending.push(...parentsOf(next));
	}

	return seen;
};

/**
 * What a passing check depended on: the Bun that ran it, every tsconfig in
 * the chain (compiler options change the result without changing the file
 * list), and every file in the program as `bun check --listFilesOnly` names
 * it -- sources, declarations and the node_modules types they reach. A file
 * contributes its size and mtime: an edit always moves one of them, and a
 * touched-but-unchanged file only costs a re-check, never a missed error.
 */
export const checkFingerprint = (
	listing: string,
	configPath: string,
	version: string = Bun.version
) => {
	const hash = createHash('sha256').update(`bun ${version}\n`);
	for (const config of configChain(configPath))
		hash.update(`${config}\n${readFileSync(config, 'utf-8')}\n`);
	const files = listing
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.startsWith('/'))
		.sort();
	for (const file of files) {
		const stats = existsSync(file) ? statSync(file) : null;
		hash.update(
			stats
				? `${file}\0${stats.size}\0${stats.mtimeMs}\n`
				: `${file}\0missing\n`
		);
	}

	return files.length > 0 ? hash.digest('hex') : null;
};
