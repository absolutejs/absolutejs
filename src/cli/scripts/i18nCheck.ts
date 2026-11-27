import { unusedKeys } from '../../i18n/catalogKeys';
import {
	findIcuIssues,
	flattenCatalog,
	validateCatalog,
	type CatalogIssue
} from '../../i18n/validateCatalog';
import {
	catalogPaths,
	flagValue,
	loadCatalog,
	projectKeyUsage
} from './i18nCatalogs';

/* `absolute i18n check [default] [locale…] [--unused] [--src <dir>]`
 *
 * Reports what no other gate does: a catalog read at runtime (JSON, so
 * `any` to the type system) that is missing keys or translates `{count}`
 * as `{n}`, and an ICU message whose braces do not balance in any
 * catalog. Both reach the visitor as template syntax today.
 *
 * Catalogs are named on the command line, or — with none named — read
 * from `i18n.catalogs` in the config, which says where each locale's
 * is. The config says where and not what: `defineI18n` is still what
 * loads them, in the app's own code.
 *
 * `--unused` also reads the project's source for the keys it uses and
 * reports the default catalog's keys nothing reads. It is a report and
 * never a failure: a key reached only through a variable cannot be
 * seen, and the report says how many such calls there are. */

type UnusedReport = {
	/** Calls whose key is not a literal: a key they read may be listed. */
	dynamicCalls: number;
	keys: string[];
};

type Report = {
	default: string;
	locales: { issues: CatalogIssue[]; path: string }[];
	unused?: UnusedReport;
};

const USAGE =
	'Usage: absolute i18n check [default-catalog] [locale-catalog…] [--unused] [--src <dir>] [--json] [--config <path>]';

const countable = (issues: CatalogIssue[], kind: CatalogIssue['kind']) =>
	issues.filter((issue) => issue.kind === kind).length;

/* `extra` is reported and does not fail: a key the default does not have
 * is dead weight, not a broken page. */
const isFatal = (issue: CatalogIssue) => issue.kind !== 'extra';

const printUnused = ({ dynamicCalls, keys }: UnusedReport) => {
	if (keys.length === 0) {
		console.log('\n✓ every key is read somewhere');

		return;
	}
	console.log(
		`\n${keys.length} key${keys.length === 1 ? '' : 's'} nothing reads by name:`
	);
	keys.forEach((key) => console.log(`  ○ ${key}`));
	if (dynamicCalls > 0)
		console.log(
			`  ${dynamicCalls} call${dynamicCalls === 1 ? ' passes' : 's pass'} a key that is not a literal, and may read one of these.`
		);
};

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
	if (report.unused) printUnused(report.unused);
};

export const i18nCheck = async (args: string[]) => {
	const json = args.includes('--json');
	const [defaultPath, ...localePaths] = await catalogPaths(args);
	if (!defaultPath) {
		console.error(USAGE);
		console.error(
			'Name the default catalog, or set i18n.catalogs in the config.'
		);
		process.exit(1);
	}
	const defaultTree = await loadCatalog(defaultPath);
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
					issues: validateCatalog(
						defaultTree,
						await loadCatalog(path)
					),
					path
				}))
			))
		]
	};
	if (args.includes('--unused')) {
		const usage = projectKeyUsage(flagValue(args, '--src') ?? '.', [
			defaultPath,
			...localePaths
		]);
		report.unused = {
			dynamicCalls: usage.dynamic,
			keys: unusedKeys(flattenCatalog(defaultTree).keys(), usage)
		};
	}
	if (json) console.log(JSON.stringify(report, null, '\t'));
	else printHuman(report);
	const fatal = report.locales.some(({ issues }) => issues.some(isFatal));
	process.exit(fatal ? 1 : 0);
};
