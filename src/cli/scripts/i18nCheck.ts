import { resolve } from 'node:path';
import { isMessageTree } from '../../i18n/translator';
import {
	findIcuIssues,
	flattenCatalog,
	validateCatalog,
	type CatalogIssue
} from '../../i18n/validateCatalog';

/* `absolute i18n check <default> [locale…]`
 *
 * Reports what no other gate does: a catalog read at runtime (JSON, so
 * `any` to the type system) that is missing keys or translates `{count}`
 * as `{n}`, and an ICU message whose braces do not balance in any
 * catalog. Both reach the visitor as template syntax today.
 *
 * Catalogs are named on the command line rather than read from
 * `absolute.config.ts`, because the config has no i18n field: `defineI18n`
 * is called in the app's own code. Discovering them would mean either
 * duplicating that declaration in the config or importing the server to
 * find it, and neither is a decision this command should make on its own.
 * One line in a CI workflow is the honest version until then. */

type Report = {
	default: string;
	locales: { issues: CatalogIssue[]; path: string }[];
};

const USAGE =
	'Usage: absolute i18n check <default-catalog> [locale-catalog…] [--json]';

const loadTree = async (path: string) => {
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

const countable = (issues: CatalogIssue[], kind: CatalogIssue['kind']) =>
	issues.filter((issue) => issue.kind === kind).length;

/* `extra` is reported and does not fail: a key the default does not have
 * is dead weight, not a broken page. */
const isFatal = (issue: CatalogIssue) => issue.kind !== 'extra';

const printHuman = (report: Report) => {
	report.locales.forEach(({ issues, path }) => {
		if (issues.length === 0) {
			console.log(`✓ ${path}`);

			return;
		}
		console.log(`\n${path}`);
		issues.forEach((issue) => {
			const mark = isFatal(issue) ? '✗' : '○';
			console.log(
				`  ${mark} ${issue.kind} ${issue.key} — ${issue.detail}`
			);
		});
		console.log(
			`  ${countable(issues, 'missing')} missing, ${countable(issues, 'mismatch')} mismatched, ${countable(issues, 'icu')} malformed, ${countable(issues, 'extra')} unused`
		);
	});
};

export const i18nCheck = async (args: string[]) => {
	const json = args.includes('--json');
	const paths = args.filter((arg) => !arg.startsWith('--'));
	const [defaultPath, ...localePaths] = paths;
	if (!defaultPath) {
		console.error(USAGE);
		process.exit(1);
	}
	const defaultTree = await loadTree(defaultPath);
	// The default catalog is the source of truth for keys, so it is only
	// checked for ICU syntax — there is nothing to compare it against.
	const report: Report = {
		default: defaultPath,
		locales: [
			{
				issues: findIcuIssues(flattenCatalog(defaultTree)),
				path: defaultPath
			},
			...(await Promise.all(
				localePaths.map(async (path) => ({
					issues: validateCatalog(defaultTree, await loadTree(path)),
					path
				}))
			))
		]
	};
	if (json) console.log(JSON.stringify(report, null, '\t'));
	else printHuman(report);
	const fatal = report.locales.some(({ issues }) => issues.some(isFatal));
	process.exit(fatal ? 1 : 0);
};
