import { discoverInstances } from '../discoverInstances';
import { enrichInstances } from '../instanceStatus';
import { colors, padLine } from '../tuiPrimitives';
import type { LiveInstance } from '../../../types/cli';
import type { RouteSource } from '../../core/routeSources';

const METHOD_COLOR: Record<string, string> = {
	DELETE: colors.red,
	GET: colors.green,
	PATCH: colors.yellow,
	POST: colors.cyan,
	PUT: colors.yellow
};

const MAX_PATH_COLUMN = 40;

const printDim = (message: string) => {
	process.stdout.write(`${colors.dim}${message}${colors.reset}\n`);
};

// Prefer a dev server (where the introspection route lives), then any tracked
// server with a URL.
const pickServer = (instances: LiveInstance[]) => {
	const withUrl = instances.filter((instance) => instance.url !== null);

	return (
		withUrl.find((instance) => instance.source === 'dev') ??
		withUrl.find((instance) => instance.source !== 'untracked') ??
		withUrl[0]
	);
};

/* A server older than this CLI sends no `source`; anything that is not
 * the expected shape reads as "not known" rather than as an error. */
const readSource = (value: unknown) => {
	if (typeof value !== 'object' || value === null) return null;
	const kind: unknown = Reflect.get(value, 'kind');
	const location: unknown = Reflect.get(value, 'location');
	if (kind !== 'call' && kind !== 'file') return null;
	if (typeof location !== 'string' || location === '') return null;
	const source: RouteSource = { kind, location };

	return source;
};

const fetchRoutes = async (url: string) => {
	try {
		const response = await fetch(`${url}__absolute/routes`);
		if (!response.ok) return null;
		const data = await response.json();
		if (!Array.isArray(data)) return null;

		return data.map((entry) => ({
			method: String(entry.method ?? '').toUpperCase(),
			path: String(entry.path ?? ''),
			source: readSource(entry.source)
		}));
	} catch {
		return null;
	}
};

export const runRoutes = async (args: string[]) => {
	const instances = await enrichInstances(await discoverInstances());
	const server = pickServer(instances);
	if (!server || server.url === null) {
		printDim(
			'No running server found. Start one with `absolute dev`, then run `absolute routes`.'
		);

		return;
	}

	const routes = await fetchRoutes(server.url);
	if (!routes) {
		printDim(
			`Could not read routes from ${server.name} — route introspection needs a dev server.`
		);

		return;
	}

	const sorted = routes
		.filter((route) => route.path !== '/__absolute/routes')
		.sort(
			(left, right) =>
				left.path.localeCompare(right.path) ||
				left.method.localeCompare(right.method)
		);

	if (args.includes('--json')) {
		process.stdout.write(`${JSON.stringify(sorted, null, 2)}\n`);

		return;
	}

	if (sorted.length === 0) {
		printDim('No routes registered.');

		return;
	}

	const methodWidth = Math.max(...sorted.map((route) => route.method.length));
	// Capped: one long asset path would otherwise push every source off
	// the right of the terminal. A longer path simply runs past the column.
	const pathWidth = Math.min(
		MAX_PATH_COLUMN,
		Math.max(...sorted.map((route) => route.path.length))
	);
	const lines = sorted.map((route) => {
		const color = METHOD_COLOR[route.method] ?? colors.dim;
		const method = `${color}${padLine(route.method, methodWidth)}${colors.reset}`;
		// The file that serves a file route, or where a route was
		// registered. Blank when the server did not say.
		if (route.source === null) return `  ${method}  ${route.path}`;

		return `  ${method}  ${padLine(route.path, pathWidth)}  ${colors.dim}${route.source.location}${colors.reset}`;
	});
	process.stdout.write(
		`${lines.join('\n')}\n\n${colors.dim}${sorted.length} routes · ${server.name}${colors.reset}\n`
	);
};
