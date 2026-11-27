import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fillCatalog } from '../../i18n/catalogKeys';
import { catalogPaths, loadCatalog } from './i18nCatalogs';

/* `absolute i18n extract [default] [locale…] [--write] [--json]`
 *
 * What each locale's catalog is missing, as the keys to add. A key a
 * locale lacks is not broken — the default locale's message is served
 * in its place — so this is a translator's to-do list, not a gate, and
 * it exits 0.
 *
 * `--write` adds them to the catalog, each with the default's message
 * as its value, in the default's key order, so the two files read side
 * by side. Only a JSON catalog is written to: a module can hold
 * comments, imports and expressions that rewriting it would lose, so
 * for one of those the keys are printed to be pasted in. */

const USAGE =
	'Usage: absolute i18n extract [default-catalog] [locale-catalog…] [--write] [--json] [--config <path>]';

type Extracted = {
	added: string[];
	path: string;
	/** Whether the keys were written into the file. */
	written: boolean;
};

const isJson = (path: string) => path.endsWith('.json');

/* The file's own indentation, so the diff is the keys added. */
const indentOf = (path: string) => {
	const [, indent = '\t'] =
		/\n([ \t]+)"/.exec(readFileSync(resolve(path), 'utf8')) ?? [];

	return indent;
};

const printHuman = (results: readonly Extracted[]) => {
	results.forEach(({ added, path, written }) => {
		if (added.length === 0) {
			console.log(`✓ ${path}`);

			return;
		}
		const verb = written ? 'added' : 'missing';
		console.log(
			`\n${path}  ${added.length} ${verb}${written || isJson(path) ? '' : ' (a module is not rewritten: add these by hand)'}`
		);
		added.forEach((key) => console.log(`  + ${key}`));
	});
};

export const i18nExtract = async (args: string[]) => {
	const [defaultPath, ...localePaths] = await catalogPaths(args);
	if (!defaultPath || localePaths.length === 0) {
		console.error(USAGE);
		console.error(
			'Name the default catalog and at least one locale’s, or set i18n.catalogs in the config.'
		);
		process.exit(1);
	}
	const shouldWrite = args.includes('--write');
	const defaultTree = await loadCatalog(defaultPath);
	const results = await Promise.all(
		localePaths.map(async (path) => {
			const { added, tree } = fillCatalog(
				defaultTree,
				await loadCatalog(path)
			);
			const written = shouldWrite && isJson(path) && added.length > 0;
			if (written)
				writeFileSync(
					resolve(path),
					`${JSON.stringify(tree, null, indentOf(path))}\n`
				);
			const result: Extracted = { added, path, written };

			return result;
		})
	);
	if (args.includes('--json'))
		console.log(JSON.stringify(results, null, '\t'));
	else printHuman(results);
};
