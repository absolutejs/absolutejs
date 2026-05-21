import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_CACHE_LOCATION = '.absolutejs/eslint-cache';

/**
 * Override the cache file location via env var. Useful in monorepos /
 * CI to avoid cache collisions across packages, or to relocate the
 * cache off a slow filesystem.
 */
const getCacheLocation = (): string =>
	process.env.ABSOLUTE_ESLINT_CACHE?.trim() || DEFAULT_CACHE_LOCATION;

/**
 * Flat-config files ESLint 9+ accepts. ESLint searches in this order
 * and uses whichever it finds first; we mirror that detection so our
 * misplaced-ignores warning runs against the same file ESLint will use.
 */
const CONFIG_CANDIDATES = [
	'eslint.config.js',
	'eslint.config.mjs',
	'eslint.config.cjs',
	'eslint.config.ts',
	'eslint.config.mts',
	'eslint.config.cts'
];

/**
 * ESLint flags that consume the *next* argv as their value. Used by
 * `hasUserPositional` to distinguish path positionals from flag values.
 * Sourced from ESLint 9 CLI docs; conservative — extra entries here
 * don't hurt, missing entries cause false-positive path detection.
 */
const FLAG_VALUE_FLAGS = new Set<string>([
	'-c',
	'--config',
	'--cache-location',
	'--cache-strategy',
	'--ignore-path',
	'--ignore-pattern',
	'--rule',
	'--rulesdir',
	'--ext',
	'-f',
	'--format',
	'--max-warnings',
	'--parser',
	'--parser-options',
	'--plugin',
	'--global',
	'--env',
	'--report-unused-disable-directives-severity',
	'--resolve-plugins-relative-to',
	'-o',
	'--output-file',
	'--flag',
	'--inspect-config',
	'--stats',
	'--concurrency'
]);

/**
 * Returns true if the user supplied any positional path (i.e. anything
 * that isn't a flag and isn't a value following a value-taking flag).
 * If the user is targeting a specific path / file, we skip appending
 * the implicit `.` so we don't expand the lint scope past their intent.
 */
const hasUserPositional = (args: string[]): boolean => {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === undefined) continue;
		if (arg.startsWith('-')) {
			// `--flag=value` is a single arg — handles its own value.
			if (arg.includes('=')) continue;
			// `--flag value` — skip the value on the next iteration.
			if (FLAG_VALUE_FLAGS.has(arg)) i++;
			continue;
		}

		return true;
	}

	return false;
};

const findConfigPath = (): string | null => {
	const cwd = process.cwd();
	for (const name of CONFIG_CANDIDATES) {
		const candidate = resolve(cwd, name);
		if (existsSync(candidate)) return candidate;
	}

	return null;
};

const hasKey = (objectLiteralSource: string, key: string): boolean => {
	const pattern = new RegExp(`(^|[\\s,{])${key}\\s*:`, 'm');

	return pattern.test(objectLiteralSource);
};

/**
 * Per ESLint v9 flat-config: a config object is a *global* ignore iff its
 * only meaningful key is `ignores`. Any of these keys disqualifies it,
 * turning it into a filtered block whose `ignores` only suppresses that
 * block's own rules. `name` is metadata and doesn't disqualify.
 */
const NON_GLOBAL_IGNORE_KEYS = [
	'files',
	'rules',
	'plugins',
	'languageOptions',
	'linterOptions',
	'processor',
	'settings',
	'extends'
];

const isGlobalIgnoresBlock = (block: string) => {
	if (!hasKey(block, 'ignores')) return false;

	return !NON_GLOBAL_IGNORE_KEYS.some((key) => hasKey(block, key));
};

/**
 * Walk the source of `defineConfig([ ... ])` (or a default-exported array)
 * and return each top-level object literal as a string. Tracks brace
 * depth, string literals, and comments so we don't false-match on
 * "{...}" appearing inside string contents or comments.
 */
const extractTopLevelObjectLiterals = (source: string): string[] => {
	const arrayStart = source.search(
		/defineConfig\s*\(\s*\[|export\s+default\s*\[/
	);
	if (arrayStart === -1) return [];
	const fromArray = source.slice(arrayStart);
	const openBracket = fromArray.indexOf('[');
	if (openBracket === -1) return [];

	const blocks: string[] = [];
	let depth = 0;
	let blockStart = -1;
	let inString: string | null = null;
	let inLineComment = false;
	let inBlockComment = false;

	for (let i = openBracket; i < fromArray.length; i++) {
		const char = fromArray[i];
		const next = fromArray[i + 1];

		if (inLineComment) {
			if (char === '\n') inLineComment = false;
			continue;
		}
		if (inBlockComment) {
			if (char === '*' && next === '/') {
				inBlockComment = false;
				i++;
			}
			continue;
		}
		if (inString) {
			if (char === '\\') {
				i++;
				continue;
			}
			if (char === inString) inString = null;
			continue;
		}
		if (char === '/' && next === '/') {
			inLineComment = true;
			continue;
		}
		if (char === '/' && next === '*') {
			inBlockComment = true;
			i++;
			continue;
		}
		if (char === '"' || char === "'" || char === '`') {
			inString = char;
			continue;
		}

		if (char === '{') {
			if (depth === 0) blockStart = i;
			depth++;
		} else if (char === '}') {
			depth--;
			if (depth === 0 && blockStart !== -1) {
				blocks.push(fromArray.slice(blockStart, i + 1));
				blockStart = -1;
			}
		} else if (char === ']' && depth === 0) {
			break;
		}
	}

	return blocks;
};

/**
 * Heuristic check for the most common flat-config v9 footgun:
 * `ignores: [...]` placed inside a config block that ALSO has
 * `files: [...]`. In flat config, `ignores` is only a *global* ignore
 * when it's the sole key in its config object — otherwise the patterns
 * apply only to that block's own rules and ESLint walks every other
 * directory (including `node_modules/**`), making lint extremely slow.
 *
 * The fix is one block per concern:
 *   { ignores: [...] }       // standalone — global ignore
 *   { files: [...], rules } // one or more focused rule blocks
 */
const checkForMisplacedIgnores = () => {
	const configPath = findConfigPath();
	if (!configPath) return;

	let source: string;
	try {
		source = readFileSync(configPath, 'utf-8');
	} catch {
		return;
	}

	const blocks = extractTopLevelObjectLiterals(source);

	// If a standalone global-ignores block exists (the fix this warning
	// itself prescribes), the slow-walk footgun cannot occur regardless
	// of any inline `{ files, ignores }` blocks elsewhere — those are
	// redundant but harmless.
	if (blocks.some(isGlobalIgnoresBlock)) return;

	let offenderCount = 0;
	for (const block of blocks) {
		if (hasKey(block, 'ignores') && hasKey(block, 'files')) {
			offenderCount++;
		}
	}

	if (offenderCount === 0) return;

	const yellow = '\x1b[33m';
	const reset = '\x1b[0m';
	const bold = '\x1b[1m';
	console.warn(
		`${yellow}${bold}⚠ ESLint flat-config warning${reset}${yellow}: found ${offenderCount} config block(s) where \`ignores\` lives alongside \`files\`. In ESLint v9, \`ignores\` is only a *global* ignore when it's the sole key in its config object — otherwise it just suppresses that block's own rules and ESLint still walks every other directory (including node_modules), making lint extremely slow.

Move ignores into a standalone block at the top of your config:

  export default defineConfig([
    { ignores: ['node_modules/**', 'dist/**', 'build/**', '.absolutejs/**'] },
    pluginJs.configs.recommended,
    ...
  ]);

Detected at: ${configPath}${reset}`
	);
};

const formatDuration = (ms: number): string => {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);

	return `${minutes}m ${seconds}s`;
};

const handleClearCache = (cacheLocation: string): void => {
	try {
		rmSync(cacheLocation, { force: true });
		console.log(`\x1b[32m✓\x1b[0m Cleared cache: ${cacheLocation}`);
	} catch (err) {
		console.error(
			`\x1b[31m✗\x1b[0m Failed to clear cache at ${cacheLocation}:`,
			err
		);
		process.exit(1);
	}
};

/**
 * Run ESLint with sensible absolutejs defaults.
 *
 * - Caching: enabled by default, cache file location overridable via
 *   the `ABSOLUTE_ESLINT_CACHE` env var (default: `.absolutejs/eslint-cache`).
 * - Implicit lint target: `.` is appended only when the user hasn't
 *   supplied a positional path of their own. So `bun lint src/backend/`
 *   lints just that directory — not the whole repo plus `src/backend/`.
 * - `--clear-cache`: handled by this script (not passed to ESLint),
 *   wipes the cache file and exits cleanly.
 *
 * NOTE: this script does NOT pass `--fix`. Autofixing is opt-in via the
 * standard ESLint flag — `bun lint --fix` works because user args are
 * spread through to the underlying `bun eslint` invocation.
 */
export const eslint = async (args: string[]) => {
	const cacheLocation = getCacheLocation();

	if (args.includes('--clear-cache')) {
		handleClearCache(cacheLocation);

		return;
	}

	// `bun eslint` would otherwise fail with a cryptic `Script not found
	// "eslint"` when the project hasn't installed ESLint. Surface an
	// actionable message instead (mirrors the typecheck checker hints).
	if (!existsSync(resolve('node_modules', '.bin', 'eslint'))) {
		console.error(
			'\x1b[31m✗\x1b[0m ESLint is not installed in this project. Add it (and a flat `eslint.config.*`): bun add -d eslint'
		);
		process.exit(1);
	}

	checkForMisplacedIgnores();

	const command = [
		'bun',
		'eslint',
		'--cache',
		'--cache-location',
		cacheLocation,
		...args,
		...(hasUserPositional(args) ? [] : ['.'])
	];

	const dim = '\x1b[2m';
	const reset = '\x1b[0m';
	console.log(
		`${dim}cache: ${cacheLocation} (subsequent runs only re-lint changed files)${reset}`
	);

	const startedAt = Date.now();
	const proc = Bun.spawn(command, {
		stderr: 'inherit',
		stdout: 'inherit'
	});
	const exitCode = await proc.exited;
	const elapsed = formatDuration(Date.now() - startedAt);

	if (exitCode !== 0) {
		console.log(`${dim}elapsed: ${elapsed}${reset}`);
		process.exit(exitCode);
	}

	console.log(`\x1b[32m✓\x1b[0m Passed ${dim}(${elapsed})${reset}`);
};
