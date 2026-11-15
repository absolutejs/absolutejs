import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ResolvedBuildPaths } from './configResolver';
import { logRoutesUpdate, logWarn } from '../utils/logger';
import {
	getObservedSpaRoutes,
	getSpaRouteManifest,
	setObservedSpaRoutes,
	setSpaRouteManifest,
	type RuntimeSpaHost
} from '../utils/spaRouteManifest';
import type { SpaHost } from '../utils/spaRouteTypes';

/* The SPA route table (`renderSpaNotFound` answers 404 for a path no SPA
 * host declares) is computed once per `build()`. The dev fast paths swap
 * edited modules without a build, so a route added to a page's
 * `defineRoutes([...])` / `createBrowserRouter([...])` / `provideRouter`
 * / `<Router>` kept answering 404 until the dev server restarted, and a
 * removed one kept rendering. Re-read each edited file's routes and patch
 * the table in place.
 *
 * Reading and publishing are separate steps: the caller publishes only once
 * the server renders the edited routes (a Vue page's SSR bundle is rebuilt
 * first), so a new path never answers 200 from a server that still renders
 * the pre-edit router. */

export type SpaFramework = 'angular' | 'react' | 'svelte' | 'vue';

export type SpaRouteChange = {
	added: string[];
	file: string;
	framework: SpaFramework;
	removed: string[];
};

type PendingRouteChange = SpaRouteChange & {
	/** Routes the 404 table enforces (a host with a static mount path). */
	next: SpaHost | null;
	/** Routes only reported (an Angular page's colocated `routes`, whose
	 *  mount path is known per request). */
	nextObserved: SpaHost | null;
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

const analyzeObservedFile = async (framework: SpaFramework, file: string) => {
	if (framework !== 'angular') return null;

	return (
		await import('../angular/staticAnalyzeSpaRoutes')
	).analyzeAngularColocatedRouteFile(file);
};

/* `null` when the file could not be read as source (a parse crash); the
 * table keeps its previous entry rather than dropping the routes. */
const readHost = async (framework: SpaFramework, file: string) => {
	try {
		const host: SpaHost | null = await analyzeFile(framework, file);
		const observed: SpaHost | null = host
			? null
			: await analyzeObservedFile(framework, file);

		return { host, observed };
	} catch (error) {
		logWarn(
			`Could not re-read SPA routes from ${file}: ${error instanceof Error ? error.message : String(error)}`
		);

		return null;
	}
};

const hostSignature = (host: SpaHost | null | undefined) =>
	host
		? JSON.stringify({ baseHref: host.baseHref, routes: host.routes })
		: '';

const routePaths = (host: SpaHost | null | undefined) =>
	new Set(host?.routes.map((route) => route.path) ?? []);

const diffRoutes = (
	before: SpaHost | null | undefined,
	after: SpaHost | null | undefined
) => {
	const beforePaths = routePaths(before);
	const afterPaths = routePaths(after);

	return {
		added: [...afterPaths].filter((path) => !beforePaths.has(path)),
		removed: [...beforePaths].filter((path) => !afterPaths.has(path))
	};
};

const findHost = (
	hosts: RuntimeSpaHost[],
	framework: SpaFramework,
	file: string
) =>
	hosts.find(
		(host) =>
			host.framework === framework &&
			normalizePath(host.sourceFile) === file
	);

const replaceHost = (
	hosts: RuntimeSpaHost[],
	change: SpaRouteChange,
	next: SpaHost | null
) => {
	const previous = findHost(hosts, change.framework, change.file);

	return [
		...hosts.filter((host) => host !== previous),
		...(next ? [{ ...next, framework: change.framework }] : [])
	];
};

const writeRouteTable = async (
	hosts: RuntimeSpaHost[],
	paths: ResolvedBuildPaths
) => {
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
};

/* Publish `pending` into the in-memory tables (plus the build's
 * `spa-routes.json`) and log one `routes update` line per file. */
const publishRouteChanges = async (
	pending: PendingRouteChange[],
	paths: ResolvedBuildPaths
) => {
	if (pending.length === 0) return;

	let hosts = getSpaRouteManifest();
	let observed = getObservedSpaRoutes();
	let enforcedChanged = false;
	for (const change of pending) {
		const previous = findHost(hosts, change.framework, change.file);
		if (hostSignature(previous) !== hostSignature(change.next))
			enforcedChanged = true;
		hosts = replaceHost(hosts, change, change.next);
		observed = replaceHost(observed, change, change.nextObserved);
	}
	setObservedSpaRoutes(observed);
	if (enforcedChanged) await writeRouteTable(hosts, paths);
	for (const change of pending) {
		logRoutesUpdate(
			change.file,
			change.framework,
			change.added,
			change.removed
		);
	}
};

/** Re-analyze `files` without touching the route table. `changes` lists
 *  each file whose routes differ from the table; `publish(frameworks?)`
 *  writes those changes (all of them, or only the given frameworks') into
 *  the table and logs them. Publishing a framework twice is a no-op. */
export const readSpaRouteChanges = async (
	files: string[],
	paths: ResolvedBuildPaths
) => {
	const candidates = [...new Set(files.map(normalizePath))].flatMap(
		(file) => {
			const framework = owningFramework(file, paths);

			return framework ? [{ file, framework }] : [];
		}
	);
	const hosts = getSpaRouteManifest();
	const observed = getObservedSpaRoutes();
	const pending: PendingRouteChange[] = [];
	await Promise.all(
		candidates.map(async ({ file, framework }) => {
			const read = await readHost(framework, file);
			if (!read) return;
			const previous = findHost(hosts, framework, file);
			const previousObserved = findHost(observed, framework, file);
			if (
				hostSignature(previous) === hostSignature(read.host) &&
				hostSignature(previousObserved) === hostSignature(read.observed)
			)
				return;
			pending.push({
				file,
				framework,
				next: read.host,
				nextObserved: read.observed,
				...diffRoutes(
					previous ?? previousObserved,
					read.host ?? read.observed
				)
			});
		})
	);
	const changes: SpaRouteChange[] = pending.map(
		({ added, file, framework, removed }) => ({
			added,
			file,
			framework,
			removed
		})
	);

	const publish = async (frameworks?: SpaFramework[]) => {
		const batch = pending.filter(
			(change) => !frameworks || frameworks.includes(change.framework)
		);
		for (const change of batch) pending.splice(pending.indexOf(change), 1);
		await publishRouteChanges(batch, paths);
	};

	return { changes, publish };
};

/** Re-analyze `files` and patch the in-memory SPA route table (plus the
 *  build's `spa-routes.json`) at once. Returns one entry per file whose
 *  routes changed; each is logged as a `routes update` line. */
export const refreshSpaRoutesForFiles = async (
	files: string[],
	paths: ResolvedBuildPaths
) => {
	const { changes, publish } = await readSpaRouteChanges(files, paths);
	await publish();

	return changes;
};
