import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ResolvedBuildPaths } from './configResolver';
import { logRoutesUpdate, logWarn } from '../utils/logger';
import {
	getSpaRouteManifest,
	setSpaRouteManifest
} from '../utils/spaRouteManifest';
import type { SpaHost } from '../utils/spaRouteTypes';

/* The SPA route table (`renderSpaNotFound` answers 404 for a path no SPA
 * host declares) is computed once per `build()`. The dev fast paths swap
 * edited modules without a build, so a route added to a page's
 * `defineRoutes([...])` / `createBrowserRouter([...])` / `provideRouter`
 * / `<Router>` kept answering 404 until the dev server restarted, and a
 * removed one kept rendering. Re-read each edited file's routes and patch
 * the table in place. */

type SpaFramework = 'angular' | 'react' | 'svelte' | 'vue';

type SpaRouteChange = {
	added: string[];
	file: string;
	framework: SpaFramework;
	removed: string[];
};

const normalizePath = (path: string) => resolve(path).replace(/\\/g, '/');

const owningFramework = (file: string, paths: ResolvedBuildPaths) => {
	const normalized = normalizePath(file);
	const directories: [SpaFramework, string | undefined][] = [
		['angular', paths.angularDir],
		['react', paths.reactDir],
		['svelte', paths.svelteDir],
		['vue', paths.vueDir]
	];
	const owners = directories.filter(
		([, directory]) =>
			directory !== undefined && normalized.startsWith(`${directory}/`)
	);
	// The deepest directory wins when one framework nests inside another.
	owners.sort(
		([, left], [, right]) => (right ?? '').length - (left ?? '').length
	);
	const [owner] = owners;

	return owner ? owner[0] : null;
};

const analyzeFile = async (framework: SpaFramework, file: string) => {
	switch (framework) {
		case 'angular':
			return (
				await import('../angular/staticAnalyzeSpaRoutes')
			).analyzeAngularSpaRouteFile(file);
		case 'react':
			return (
				await import('../react/staticAnalyzeSpaRoutes')
			).analyzeReactSpaRouteFile(file);
		case 'svelte':
			return (
				await import('../svelte/staticAnalyzeSpaRoutes')
			).analyzeSvelteSpaRouteFile(file);
		case 'vue':
			return (
				await import('../vue/staticAnalyzeSpaRoutes')
			).analyzeVueSpaRouteFile(file);
		default:
			return null;
	}
};

/* `null` when the file could not be read as source (a parse crash); the
 * table keeps its previous entry rather than dropping the routes. */
const readHost = async (framework: SpaFramework, file: string) => {
	try {
		const host: SpaHost | null = await analyzeFile(framework, file);

		return { host };
	} catch (error) {
		logWarn(
			`Could not re-read SPA routes from ${file}: ${error instanceof Error ? error.message : String(error)}`
		);

		return null;
	}
};

const hostSignature = (host: SpaHost | undefined) =>
	host
		? JSON.stringify({ baseHref: host.baseHref, routes: host.routes })
		: '';

const routePaths = (host: SpaHost | undefined) =>
	new Set(host?.routes.map((route) => route.path) ?? []);

const diffRoutes = (
	before: SpaHost | undefined,
	after: SpaHost | undefined
) => {
	const beforePaths = routePaths(before);
	const afterPaths = routePaths(after);

	return {
		added: [...afterPaths].filter((path) => !beforePaths.has(path)),
		removed: [...beforePaths].filter((path) => !afterPaths.has(path))
	};
};

/** Re-analyze `files` and patch the in-memory SPA route table (plus the
 *  build's `spa-routes.json`). Returns one entry per file whose routes
 *  changed; each is logged as a `routes update` line. */
export const refreshSpaRoutesForFiles = async (
	files: string[],
	paths: ResolvedBuildPaths
) => {
	const candidates = [...new Set(files.map(normalizePath))].flatMap(
		(file) => {
			const framework = owningFramework(file, paths);

			return framework ? [{ file, framework }] : [];
		}
	);
	if (candidates.length === 0) return [];

	let hosts = getSpaRouteManifest();
	const changes: SpaRouteChange[] = [];
	await Promise.all(
		candidates.map(async ({ file, framework }) => {
			const read = await readHost(framework, file);
			if (!read) return;
			const next = read.host;
			const previous = hosts.find(
				(host) =>
					host.framework === framework &&
					normalizePath(host.sourceFile) === file
			);
			if (hostSignature(previous) === hostSignature(next ?? undefined))
				return;
			hosts = [
				...hosts.filter((host) => host !== previous),
				...(next ? [{ ...next, framework }] : [])
			];
			changes.push({
				file,
				framework,
				...diffRoutes(previous, next ?? undefined)
			});
		})
	);
	if (changes.length === 0) return changes;

	setSpaRouteManifest(hosts);
	try {
		await writeFile(
			join(paths.buildDir, 'spa-routes.json'),
			JSON.stringify(hosts, null, '\t')
		);
	} catch {
		// The in-memory table is authoritative while dev runs; the file only
		// seeds `prepare()` on the next start, which rebuilds it anyway.
	}
	for (const change of changes) {
		logRoutesUpdate(
			change.file,
			change.framework,
			change.added,
			change.removed
		);
	}

	return changes;
};
