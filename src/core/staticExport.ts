/* Assembling a directory a static host can serve.
 *
 * The build directory is not that directory, and the gap is larger than it
 * looks. Measured against the example app's own production build: of 27.36
 * MB in 343 files, 21.50 MB is server-only — the bundled server (3.69 MB),
 * its source map (8.09 MB), the SSR page bundles, the runtime manifests and
 * a 2.77 MB platform-specific `tailwindcss-oxide` native binary. Only 5.86
 * MB belongs to a browser.
 *
 * In production none of that reaches a client, because `absolute start`
 * mounts the directory behind the ignore patterns in
 * `serverOnlyStaticFiles.ts` — verified by probing a running server, where
 * `/server.js`, `/server.js.map`, `/manifest.json` and the `.node` binary
 * all answer 404. That protection is a property of the running server, so
 * copying the same directory to S3, Netlify or GitHub Pages loses every bit
 * of it and `GET /server.js` works again. An export therefore cannot be a
 * recursive copy; it has to apply the same classification without a server
 * to apply it.
 *
 * Pure: paths in, a plan out. `writeStaticExport` is the only part that
 * touches the disk, so what gets exported is decided by code a test can
 * call with no build, no server and no network. */

import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/* Jekyll, which GitHub Pages runs unless told not to, skips every path
 * whose name starts with `.` or `_`. That is not a cosmetic problem here: a
 * React page's hydration index is served from
 * `/.absolutejs/generated/react/indexes/…`, so on GitHub Pages without this
 * file the page arrives and silently never hydrates — the exact failure
 * that is hardest to attribute to the host. One empty file prevents it, so
 * it is written unconditionally rather than behind a `--github` flag
 * nobody would know to pass. */
export const NOJEKYLL_FILE = '.nojekyll';

/** A build-directory file to copy verbatim. `from` is the file's path
 *  relative to the build directory, with a leading slash, as the ignore
 *  patterns match it; `to` is its path inside the export directory. */
export type StaticExportCopy = {
	from: string;
	to: string;
};

export type StaticExportInput = {
	/** Every file in the build directory, each as a leading-slash path
	 *  relative to it. */
	buildFiles: readonly string[];
	/** Whether a build file is one only the server may read. Supplied by
	 *  the caller so that the export and the production server answer this
	 *  question with the same code. */
	isServerOnly: (path: string) => boolean;
	layout: StaticExportLayout;
	/** Keep the build's `.br` and `.gz` siblings. Off by default: a static
	 *  host either negotiates encodings itself (Netlify, Cloudflare,
	 *  Vercel) or needs per-object metadata that a file tree cannot carry
	 *  (S3), so for most hosts they are 1.61 MB of the example app's 5.86
	 *  MB public payload that nothing will ever request. */
	precompressed: boolean;
	/** What the pre-render pass produced, as `PrerenderResult.routes`
	 *  gives it: a route and the absolute path of its HTML. */
	prerendered: readonly StaticExportPage[];
};

/** How a route becomes a file. `directory` writes `/about` as
 *  `about/index.html`, which every static host serves at `/about` with no
 *  configuration. `flat` writes `about.html`, which is shorter and works
 *  on hosts that try adding `.html` themselves (GitHub Pages, Netlify) but
 *  404s on a plain S3 website bucket. */
export type StaticExportLayout = 'directory' | 'flat';

export type StaticExportPage = {
	/** Absolute path of the pre-rendered HTML. */
	file: string;
	route: string;
};

export type StaticExportPlan = {
	copies: StaticExportCopy[];
	/** Pre-rendered HTML, with the path it takes in the export. */
	pages: StaticExportPagePlan[];
	skipped: StaticExportSkip[];
};

export type StaticExportPagePlan = {
	file: string;
	route: string;
	to: string;
};

export type StaticExportSkip = {
	path: string;
	reason: StaticExportSkipReason;
};

/** Why a build file is not in the export.
 *
 *  `server-only` is the classification above. `prerender-source` is the
 *  build's own `_prerendered/` directory, whose contents the export places
 *  at the routes they serve instead of copying them where nothing would
 *  look for them. `precompressed` is a `.br`/`.gz` sibling. `page-override`
 *  is a build file a pre-rendered route writes over — a real collision,
 *  reported rather than resolved silently. */
export type StaticExportSkipReason =
	'page-override' | 'precompressed' | 'prerender-source' | 'server-only';

export type StaticExportResult = {
	bytes: number;
	files: number;
};

const PRERENDER_DIR_PREFIX = '/_prerendered/';

const PRECOMPRESSED_PATTERN = /\.(?:br|gz)$/u;

/** What the export will contain, and what it leaves behind with the reason
 *  for each. Decides nothing from the disk: every input is a path. */
export const planStaticExport = ({
	buildFiles,
	isServerOnly,
	layout,
	precompressed,
	prerendered
}: StaticExportInput) => {
	const pages = prerendered.map((page) => ({
		file: page.file,
		route: page.route,
		to: routeToStaticPath(page.route, layout)
	}));
	const pagePaths = new Set(pages.map((page) => page.to));
	const plan: StaticExportPlan = { copies: [], pages, skipped: [] };

	for (const path of buildFiles)
		recordBuildFile({ isServerOnly, pagePaths, path, plan, precompressed });

	return plan;
};

type RecordInput = {
	isServerOnly: (path: string) => boolean;
	pagePaths: ReadonlySet<string>;
	path: string;
	plan: StaticExportPlan;
	precompressed: boolean;
};

const skipReasonFor = ({
	isServerOnly,
	pagePaths,
	path,
	precompressed
}: Omit<RecordInput, 'plan'>) => {
	if (isServerOnly(path)) return 'server-only';
	if (path.startsWith(PRERENDER_DIR_PREFIX)) return 'prerender-source';
	if (!precompressed && PRECOMPRESSED_PATTERN.test(path))
		return 'precompressed';
	if (pagePaths.has(path.slice(1))) return 'page-override';

	return null;
};

const recordBuildFile = ({ plan, ...rest }: RecordInput) => {
	const reason = skipReasonFor(rest);
	if (reason !== null) {
		plan.skipped.push({ path: rest.path, reason });

		return;
	}
	plan.copies.push({ from: rest.path, to: rest.path.slice(1) });
};

/** The file a route is written to, relative to the export directory.
 *
 *  A route carrying a query or fragment is reduced to its path: those are
 *  not part of a file name and a host never sees them. A route that already
 *  names an `.html` file keeps it. */
export const routeToStaticPath = (
	route: string,
	layout: StaticExportLayout
) => {
	const path = (route.split(/[?#]/u)[0] ?? '').replace(/^\/+|\/+$/gu, '');
	if (path === '') return 'index.html';
	if (path.endsWith('.html')) return path;

	return layout === 'flat' ? `${path}.html` : `${path}/index.html`;
};

const writeInto = async (destination: string, write: () => Promise<void>) => {
	await mkdir(dirname(destination), { recursive: true });
	await write();
};

const sizeOf = async (path: string) => {
	const info = await stat(path).catch(() => null);

	return info === null ? 0 : info.size;
};

/** Write the plan to `exportDir`, which must already exist and should be
 *  empty: nothing here removes a file, so an export over a previous one
 *  leaves routes that no longer exist in place. The CLI clears it. */
export const writeStaticExport = async (
	plan: StaticExportPlan,
	buildDir: string,
	exportDir: string
) => {
	const result: StaticExportResult = { bytes: 0, files: 0 };

	for (const copy of plan.copies) {
		const source = join(buildDir, copy.from.slice(1));
		const destination = join(exportDir, copy.to);
		// eslint-disable-next-line no-await-in-loop -- one shared tree: parallel mkdir of the same parents races
		await writeInto(destination, () => cp(source, destination));
		// eslint-disable-next-line no-await-in-loop -- sequential by the same reason
		result.bytes += await sizeOf(destination);
		result.files += 1;
	}

	for (const page of plan.pages) {
		const destination = join(exportDir, page.to);
		// eslint-disable-next-line no-await-in-loop -- as above
		await writeInto(destination, () => cp(page.file, destination));
		// eslint-disable-next-line no-await-in-loop -- as above
		result.bytes += await sizeOf(destination);
		result.files += 1;
	}

	await writeFile(join(exportDir, NOJEKYLL_FILE), '');
	result.files += 1;

	return result;
};
