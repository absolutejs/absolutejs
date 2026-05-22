import { parse } from 'jsonc-parser';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isRecord } from '../guards';
import type { PrettierFormat } from '../../../../types/prettier';
import type { SupportOption } from 'prettier';

// JSON-shaped configs we can read and rewrite in place.
const JSON_CANDIDATES = [
	'.prettierrc',
	'.prettierrc.json',
	'.prettierrc.json5'
];
// Non-JSON configs we surface but won't rewrite (would need a JS/YAML writer).
const OTHER_CANDIDATES = [
	'.prettierrc.yaml',
	'.prettierrc.yml',
	'.prettierrc.toml',
	'.prettierrc.js',
	'.prettierrc.cjs',
	'.prettierrc.mjs',
	'.prettierrc.ts',
	'prettier.config.js',
	'prettier.config.cjs',
	'prettier.config.mjs',
	'prettier.config.ts'
];

// Display order; any category prettier reports beyond these is appended.
const CATEGORY_ORDER = ['Global', 'Common', 'JavaScript', 'HTML', 'Markdown'];

// Prettier's metadata is the source of truth — load it from the installed copy
// (reflecting its version + plugins) rather than maintaining our own catalog.
// `getSupportInfo()` also lists programmatic/CLI-only options (cursorOffset,
// filepath, plugins, parser, …); keep only editable formatting options.
let cachedOptions: SupportOption[] | null = null;

const loadOptions = async () => {
	if (cachedOptions) return cachedOptions;
	try {
		const prettier = await import('prettier');
		const info = await prettier.getSupportInfo();
		cachedOptions = info.options.filter(
			(option) =>
				typeof option.name === 'string' &&
				option.category !== 'Special' &&
				option.type !== 'path' &&
				option.name !== 'parser' &&
				!option.deprecated
		);
	} catch {
		cachedOptions = [];
	}

	return cachedOptions;
};

const readJsonObject = (path: string) => {
	try {
		const parsed = parse(readFileSync(path, 'utf-8'));

		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
};

const discover = (cwd: string) => {
	for (const name of JSON_CANDIDATES) {
		const candidate = resolve(cwd, name);
		if (existsSync(candidate) && readJsonObject(candidate)) {
			return { configPath: candidate, format: 'json' as PrettierFormat };
		}
	}

	const pkgPath = resolve(cwd, 'package.json');
	const pkg = existsSync(pkgPath) ? readJsonObject(pkgPath) : null;
	if (pkg && isRecord(pkg.prettier)) {
		return { configPath: pkgPath, format: 'package' as PrettierFormat };
	}

	for (const name of OTHER_CANDIDATES) {
		const candidate = resolve(cwd, name);
		if (existsSync(candidate)) {
			return { configPath: candidate, format: 'other' as PrettierFormat };
		}
	}

	return { configPath: null, format: 'none' as PrettierFormat };
};

const readCurrent = (
	cwd: string,
	configPath: string | null,
	format: PrettierFormat
) => {
	if (format === 'json' && configPath)
		return readJsonObject(configPath) ?? {};
	if (format === 'package') {
		const pkg = readJsonObject(resolve(cwd, 'package.json'));

		return pkg && isRecord(pkg.prettier) ? pkg.prettier : {};
	}

	return {};
};

export const resolvePrettierState = async (cwd: string) => {
	const options = await loadOptions();
	const { configPath, format } = discover(cwd);
	const current = readCurrent(cwd, configPath, format);
	const present = new Set(options.map((option) => option.category));
	const known = CATEGORY_ORDER.filter((category) => present.has(category));
	const extra = [...present].filter(
		(category) => !CATEGORY_ORDER.includes(category)
	);

	return {
		available: options.length > 0,
		categories: [...known, ...extra],
		configPath,
		current,
		editable: options.length > 0 && format !== 'other',
		format,
		options
	};
};
