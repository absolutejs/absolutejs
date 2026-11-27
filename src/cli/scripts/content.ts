import {
	auditContent,
	sitemapPaths,
	uncoveredRoutes,
	type PageContent
} from '../../build/auditContent';
import { scanFileRoutes } from '../../build/fileRoutes';
import { loadConfig } from '../../utils/loadConfig';
import { discoverInstances } from '../discoverInstances';
import { enrichInstances } from '../instanceStatus';
import type { BuildConfig } from '../../../types/build';
import type { LiveInstance } from '../../../types/cli';

/* `absolute content [paths…] [--url <origin>] [--header 'Name: value']
 *                   [--min-words <n>] [--json] [--config <path>]`
 *
 * Fetches each page of a running server the way a crawler that runs no
 * JavaScript does, and says how much text each one has in its HTML and
 * why some of it is missing (build/auditContent.ts).
 *
 * It fetches rather than scans the source, because the commonest reason
 * a page is empty to such a reader — a component that fetches its data
 * after it mounts — leaves no trace in the source that a scan could
 * tell from a component that does not.
 *
 * The cost of fetching is that it needs a server, and that it checks
 * only the pages it can name: the sitemap's, and any passed as
 * arguments. What it did not check is listed rather than left out, so a
 * clean run is never read as "every page is fine". It exits 1 on a
 * finding, so CI can decide. */

const USAGE =
	"Usage: absolute content [paths…] [--url <origin>] [--header 'Name: value'] [--min-words <n>] [--json] [--config <path>]";

const VALUE_FLAGS = new Set(['--config', '--header', '--min-words', '--url']);

type ContentArgs = {
	configPath?: string;
	headers: Record<string, string>;
	json: boolean;
	minWords: number;
	paths: string[];
	url?: string;
};

type Checked = PageContent & { path: string };
type Unchecked = { path: string; reason: string };
type ContentReport = {
	checked: Checked[];
	origin: string;
	unchecked: Unchecked[];
};

const valuesOf = (args: string[], flag: string) =>
	args.flatMap((arg, index) => {
		const value = args[index + 1];

		return arg === flag && value !== undefined ? [value] : [];
	});

const headerPair = (header: string) => {
	const colon = header.indexOf(':');
	if (colon < 1) return [];

	return [[header.slice(0, colon).trim(), header.slice(colon + 1).trim()]];
};

const parseArgs = (args: string[]) => {
	const [configPath] = valuesOf(args, '--config');
	const [url] = valuesOf(args, '--url');
	const [minWords] = valuesOf(args, '--min-words');
	const parsed: ContentArgs = {
		...(configPath === undefined ? {} : { configPath }),
		headers: Object.fromEntries(
			valuesOf(args, '--header').flatMap(headerPair)
		),
		json: args.includes('--json'),
		minWords: Math.max(0, Number.parseInt(minWords ?? '0', 10) || 0),
		paths: args.filter(
			(arg, index) =>
				arg.startsWith('/') && !VALUE_FLAGS.has(args[index - 1] ?? '')
		),
		...(url === undefined ? {} : { url })
	};

	return parsed;
};

/* The server to ask: this project's, and a production one before a dev
 * one, since that is what a crawler meets. */
const pickServer = (instances: LiveInstance[]) => {
	const here = instances.filter(
		(instance) => instance.url !== null && instance.cwd === process.cwd()
	);

	return here.find((instance) => instance.source !== 'dev') ?? here[0];
};

const findOrigin = async (url: string | undefined) => {
	if (url !== undefined) return url.replace(/\/+$/, '');
	const server = pickServer(await enrichInstances(await discoverInstances()));

	return server?.url?.replace(/\/+$/, '');
};

const readConfig = async (configPath: string | undefined) => {
	try {
		return await loadConfig(configPath);
	} catch {
		// A server can be audited from anywhere; without the project's
		// config the only loss is the list of routes not checked.
		return undefined;
	}
};

const routePathsOf = (config: BuildConfig | undefined) =>
	config === undefined
		? []
		: scanFileRoutes(config).routes.map(
				(route) => route.typePath ?? route.path
			);

const listedPaths = async (origin: string, headers: Record<string, string>) => {
	try {
		const response = await fetch(`${origin}/sitemap.xml`, { headers });

		return response.ok ? sitemapPaths(await response.text()) : [];
	} catch {
		return [];
	}
};

const check = async (
	origin: string,
	path: string,
	headers: Record<string, string>,
	minWords: number
) => {
	const unchecked = (reason: string) => {
		const result: Unchecked = { path, reason };

		return result;
	};
	try {
		const response = await fetch(`${origin}${path}`, {
			headers: { accept: 'text/html', ...headers },
			redirect: 'manual'
		});
		const location = response.headers.get('location');
		if (location !== null)
			return unchecked(`answered ${response.status} to ${location}`);
		if (!response.ok) return unchecked(`answered ${response.status}`);
		if (!(response.headers.get('content-type') ?? '').includes('html'))
			return unchecked('is not an HTML page');
		const result: Checked = {
			...auditContent(await response.text(), { minWords }),
			path
		};

		return result;
	} catch (error) {
		return unchecked(
			`could not be fetched: ${error instanceof Error ? error.message : String(error)}`
		);
	}
};

const isChecked = (result: Checked | Unchecked): result is Checked =>
	'words' in result;

const isUnchecked = (result: Checked | Unchecked): result is Unchecked =>
	'reason' in result;

const printReport = ({ checked, origin, unchecked }: ContentReport) => {
	const width = Math.max(0, ...checked.map((page) => page.path.length));
	const lines = checked.map((page) => {
		const said = [
			...page.findings.map((finding) => finding.message),
			...page.notes
		].join('; ');

		return `  ${page.findings.length > 0 ? '✗' : '✓'} ${page.path.padEnd(width)}  ${String(page.words).padStart(6)} words${said === '' ? '' : `  ${said}`}`;
	});
	console.log(
		`${checked.length} page${checked.length === 1 ? '' : 's'} at ${origin}, read as a crawler that runs no JavaScript:\n`
	);
	if (lines.length > 0) console.log(lines.join('\n'));
	if (unchecked.length === 0) return;
	console.log(
		`\nNot checked:\n${unchecked.map((page) => `  ${page.path}  ${page.reason}`).join('\n')}`
	);
};

export const content = async (args: string[]) => {
	const parsed = parseArgs(args);
	const origin = await findOrigin(parsed.url);
	if (origin === undefined) {
		console.error(
			'No running server found for this project. Start one with `absolute start`, or name one with --url.'
		);
		console.error(USAGE);
		process.exit(1);
	}
	const routePaths = routePathsOf(await readConfig(parsed.configPath));
	const listed = await listedPaths(origin, parsed.headers);
	// No sitemap (a dev server writes none): the static file routes.
	const fallback = routePaths.filter((path) => !/[:*]/.test(path));
	const paths = [
		...new Set([
			...(listed.length > 0 ? listed : fallback),
			...parsed.paths
		])
	].sort();
	const results = await Promise.all(
		paths.map((path) =>
			check(origin, path, parsed.headers, parsed.minWords)
		)
	);
	const report: ContentReport = {
		checked: results.filter(isChecked),
		origin,
		unchecked: [
			...results.filter(isUnchecked),
			...uncoveredRoutes(routePaths, paths).map((path) => ({
				path,
				reason: 'is dynamic and nothing lists its pages: pass one as an argument'
			}))
		]
	};
	if (parsed.json) console.log(JSON.stringify(report, null, '\t'));
	else printReport(report);
	if (report.checked.some((page) => page.findings.length > 0))
		process.exit(1);
};
