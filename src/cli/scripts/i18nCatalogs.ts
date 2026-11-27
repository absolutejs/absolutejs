import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, resolve } from 'node:path';
import { keyUsageOf, mergeKeyUsage } from '../../i18n/catalogKeys';
import { isMessageTree } from '../../i18n/translator';
import { loadConfig } from '../../utils/loadConfig';

/* What the `absolute i18n` commands share: finding the catalogs,
 * loading one, and reading the project's source for the keys it uses. */

const FLAGS_WITH_VALUES = new Set(['--config', '--src']);

/** The arguments that are paths: not a flag, and not a flag's value. */
const pathArguments = (args: readonly string[]) =>
	args.filter(
		(arg, index) =>
			!arg.startsWith('--') &&
			!FLAGS_WITH_VALUES.has(args[index - 1] ?? '')
	);

const configuredCatalogs = async (configPath: string | undefined) => {
	try {
		const { i18n } = await loadConfig(configPath);
		const catalogs: Record<string, string | undefined> =
			i18n?.catalogs ?? {};
		const defaultPath = i18n ? catalogs[i18n.defaultLocale] : undefined;
		if (!i18n || defaultPath === undefined) return undefined;

		return [
			defaultPath,
			...i18n.locales.flatMap((locale) => {
				const path = catalogs[locale];

				return locale === i18n.defaultLocale || path === undefined
					? []
					: [path];
			})
		];
	} catch {
		return undefined;
	}
};

/** The catalogs to work on, the default locale's first: the paths
 *  given, or `i18n.catalogs` in the config when none is. */
export const catalogPaths = async (args: readonly string[]) => {
	const given = pathArguments(args);
	if (given.length > 0) return given;

	return (await configuredCatalogs(flagValue(args, '--config'))) ?? [];
};

export const flagValue = (args: readonly string[], flag: string) => {
	const index = args.indexOf(flag);

	return index < 0 ? undefined : args[index + 1];
};

/** A catalog from a JSON file, or from a module whose default export is
 *  one. */
export const loadCatalog = async (path: string) => {
	const absolute = resolve(path);
	const loaded: unknown = absolute.endsWith('.json')
		? await Bun.file(absolute).json()
		: await import(absolute).then(
				(module: { default?: unknown }) => module.default ?? module
			);
	if (isMessageTree(loaded)) return loaded;

	throw new Error(
		`${path} is not a catalog of nested string messages. A JSON file, or a module whose default export is one.`
	);
};

const SKIP_DIRS = new Set([
	'build',
	'compiled',
	'coverage',
	'dist',
	'node_modules',
	'start-build'
]);
const SOURCE_EXTENSIONS = new Set([
	'.htm',
	'.html',
	'.js',
	'.jsx',
	'.mjs',
	'.svelte',
	'.ts',
	'.tsx',
	'.vue'
]);

const sourceFiles = (dir: string): string[] => {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	return entries.flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory())
			return SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')
				? []
				: sourceFiles(path);
		const dot = entry.name.lastIndexOf('.');

		return dot >= 0 && SOURCE_EXTENSIONS.has(entry.name.slice(dot))
			? [path]
			: [];
	});
};

const readSource = (file: string) => {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		return '';
	}
};

/** The catalog keys the source under `root` reads. The catalogs
 *  themselves are left out: a key is not read by being defined. */
export const projectKeyUsage = (root: string, catalogs: readonly string[]) => {
	const own = new Set(catalogs.map((path) => resolve(path)));

	return mergeKeyUsage(
		sourceFiles(resolve(root))
			.filter((file) => !own.has(file))
			.map((file) => keyUsageOf(readSource(file)))
	);
};
