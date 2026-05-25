import { findServer } from '../inspectData';
import { colors, padLine } from '../tuiPrimitives';
import { openUrlInBrowser } from '../utils';

// Bridges to @elysiajs/openapi: reads the spec the plugin generates from your
// route schemas (/openapi/json) and renders the surface, or opens the Scalar UI.
// No spec is generated here — the official plugin owns that.

const METHOD_COLOR: Record<string, string> = {
	DELETE: colors.red,
	GET: colors.green,
	PATCH: colors.yellow,
	POST: colors.cyan,
	PUT: colors.yellow
};

const HTTP_METHODS = new Set([
	'delete',
	'get',
	'head',
	'options',
	'patch',
	'post',
	'put'
]);

const printDim = (message: string) =>
	process.stdout.write(`${colors.dim}${message}${colors.reset}\n`);

const isInternal = (path: string) =>
	path.startsWith('/__absolute') ||
	path.startsWith('/openapi') ||
	path.startsWith('/hmr') ||
	path.startsWith('/_') ||
	path.startsWith('/@') ||
	path.startsWith('/.') ||
	path.startsWith('/chunk-') ||
	path.startsWith('/node_modules');

const fetchSpec = async (url: string) => {
	try {
		const response = await fetch(`${url}openapi/json`);
		if (!response.ok) return null;

		return await response.json();
	} catch {
		return null;
	}
};

const getProp = (value: unknown, key: string) =>
	typeof value === 'object' && value !== null
		? Reflect.get(value, key)
		: undefined;

const propertyNames = (schema: unknown) => {
	const properties = getProp(schema, 'properties');

	return typeof properties === 'object' && properties !== null
		? Object.keys(properties)
		: [];
};

const summarize = (operation: unknown) => {
	const parameters = getProp(operation, 'parameters');
	const names = Array.isArray(parameters)
		? parameters
				.map((param: unknown) => getProp(param, 'name'))
				.filter(
					(name: unknown): name is string => typeof name === 'string'
				)
		: [];
	const json = getProp(getProp(operation, 'requestBody'), 'content');
	const body = propertyNames(
		getProp(getProp(json, 'application/json'), 'schema')
	);
	const parts: string[] = [];
	if (names.length > 0) parts.push(`params: ${names.join(', ')}`);
	if (body.length > 0) parts.push(`body: ${body.join(', ')}`);

	return parts.length > 0
		? `  ${colors.dim}${parts.join(' · ')}${colors.reset}`
		: '';
};

const surfaceRows = (spec: unknown) => {
	const paths = Reflect.get(spec ?? {}, 'paths');
	if (typeof paths !== 'object' || paths === null) return [];

	return Object.entries(paths)
		.filter(([path]) => !isInternal(path))
		.flatMap(([path, methods]) =>
			Object.entries(methods ?? {})
				.filter(([method]) => HTTP_METHODS.has(method))
				.map(([method, operation]) => ({
					method: method.toUpperCase(),
					path,
					summary: summarize(operation)
				}))
		);
};

export const runApi = async (args: string[]) => {
	const server = await findServer();
	if (!server || server.url === null) {
		printDim(
			'No running server found. Start one with `absolute dev`, then run `absolute api`.'
		);

		return;
	}

	if (args.includes('--open')) {
		openUrlInBrowser(`${server.url}openapi`, printDim);
		printDim(`Opening ${server.url}openapi`);

		return;
	}

	const spec = await fetchSpec(server.url);
	if (!spec) {
		printDim(
			'OpenAPI is not enabled. Set `openapi: true` in absolute.config.ts (on by default in dev).'
		);

		return;
	}

	if (args.includes('--json')) {
		process.stdout.write(`${JSON.stringify(spec, null, 2)}\n`);

		return;
	}

	const rows = surfaceRows(spec).sort(
		(left, right) =>
			left.path.localeCompare(right.path) ||
			left.method.localeCompare(right.method)
	);
	if (rows.length === 0) {
		printDim('No documented routes yet.');

		return;
	}

	const methodWidth = Math.max(...rows.map((row) => row.method.length));
	const lines = rows.map((row) => {
		const color = METHOD_COLOR[row.method] ?? colors.dim;

		return `  ${color}${padLine(row.method, methodWidth)}${colors.reset}  ${row.path}${row.summary}`;
	});
	process.stdout.write(
		`${lines.join('\n')}\n\n${colors.dim}${rows.length} routes · ${server.name} · \`absolute api --open\` for the UI${colors.reset}\n`
	);
};
