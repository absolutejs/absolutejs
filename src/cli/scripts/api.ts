import { findServer } from '../inspectData';
import { colors, padLine } from '../tuiPrimitives';

// Renders a project's API surface from the live dev route table — and, with
// --openapi, emits a real OpenAPI 3 document built from Elysia's TypeBox
// schemas (params/query/body/response), which are already JSON-Schema shaped.

const METHOD_COLOR: Record<string, string> = {
	DELETE: colors.red,
	GET: colors.green,
	PATCH: colors.yellow,
	POST: colors.cyan,
	PUT: colors.yellow
};

type RouteSchema = {
	body: unknown;
	params: unknown;
	query: unknown;
	response: unknown;
};

type ApiRoute = { method: string; path: string; schema: RouteSchema };

const printDim = (message: string) =>
	process.stdout.write(`${colors.dim}${message}${colors.reset}\n`);

const fetchRoutes = async (url: string) => {
	try {
		const response = await fetch(`${url}__absolute/routes`);
		if (!response.ok) return null;
		const data = await response.json();
		if (!Array.isArray(data)) return null;

		return data.map(
			(entry): ApiRoute => ({
				method: String(entry.method ?? '').toUpperCase(),
				path: String(entry.path ?? ''),
				schema: {
					body: entry.schema?.body ?? null,
					params: entry.schema?.params ?? null,
					query: entry.schema?.query ?? null,
					response: entry.schema?.response ?? null
				}
			})
		);
	} catch {
		return null;
	}
};

const ASSET_PATH = /\.[a-z0-9]+$/i;

// Hide dev-machinery routes (HMR, source proxy, image optimizer, devtools,
// chunks) and asset-serving routes so the surface is the app's real routes.
const isInternal = (path: string) =>
	path === '*' ||
	path.startsWith('/_') ||
	path.startsWith('/.') ||
	path.startsWith('/@') ||
	path.startsWith('/chunk-') ||
	path.startsWith('/node_modules') ||
	path.startsWith('/hmr') ||
	ASSET_PATH.test(path);

const getProp = (value: unknown, key: string) =>
	typeof value === 'object' && value !== null
		? Reflect.get(value, key)
		: undefined;

// A TypeBox object schema is already a JSON Schema; pull its property names.
const propertyNames = (schema: unknown) => {
	const properties = getProp(schema, 'properties');

	return typeof properties === 'object' && properties !== null
		? Object.keys(properties)
		: [];
};

const schemaHint = (route: ApiRoute) => {
	const parts: string[] = [];
	const params = propertyNames(route.schema.params);
	const body = propertyNames(route.schema.body);
	const query = propertyNames(route.schema.query);
	if (params.length > 0) parts.push(`params: ${params.join(', ')}`);
	if (query.length > 0) parts.push(`query: ${query.join(', ')}`);
	if (body.length > 0) parts.push(`body: ${body.join(', ')}`);

	return parts.length > 0
		? `  ${colors.dim}${parts.join(' · ')}${colors.reset}`
		: '';
};

const toOpenApiPath = (path: string) =>
	path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

const paramObjects = (schema: unknown, location: 'path' | 'query') => {
	const properties = getProp(schema, 'properties');
	if (typeof properties !== 'object' || properties === null) return [];
	const required = getProp(schema, 'required');
	const requiredList = Array.isArray(required) ? required : [];

	return Object.entries(properties).map(([name, propSchema]) => ({
		in: location,
		name,
		required: requiredList.includes(name),
		schema: propSchema
	}));
};

const buildResponses = (response: unknown) => {
	if (typeof response !== 'object' || response === null) {
		return { '200': { description: 'OK' } };
	}
	if (typeof getProp(response, 'type') === 'string') {
		return {
			'200': {
				content: { 'application/json': { schema: response } },
				description: 'OK'
			}
		};
	}
	const responses: Record<string, unknown> = {};
	for (const [status, schema] of Object.entries(response)) {
		responses[status] = {
			content: { 'application/json': { schema } },
			description: 'Response'
		};
	}

	return responses;
};

const operationFor = (route: ApiRoute) => {
	const operation: Record<string, unknown> = {
		operationId: `${route.method.toLowerCase()}${route.path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
		parameters: [
			...paramObjects(route.schema.params, 'path'),
			...paramObjects(route.schema.query, 'query')
		],
		responses: buildResponses(route.schema.response)
	};
	if (route.schema.body !== null) {
		operation.requestBody = {
			content: { 'application/json': { schema: route.schema.body } }
		};
	}

	return operation;
};

const buildOpenApi = (routes: ApiRoute[]) => {
	const paths: Record<string, Record<string, unknown>> = {};
	for (const route of routes) {
		const openApiPath = toOpenApiPath(route.path);
		paths[openApiPath] = paths[openApiPath] ?? {};
		paths[openApiPath][route.method.toLowerCase()] = operationFor(route);
	}

	return {
		info: { title: 'AbsoluteJS API', version: '1.0.0' },
		openapi: '3.0.3',
		paths
	};
};

const printSurface = (routes: ApiRoute[], serverName: string) => {
	const sorted = [...routes].sort(
		(left, right) =>
			left.path.localeCompare(right.path) ||
			left.method.localeCompare(right.method)
	);
	const methodWidth = Math.max(...sorted.map((route) => route.method.length));
	const lines = sorted.map((route) => {
		const color = METHOD_COLOR[route.method] ?? colors.dim;

		return `  ${color}${padLine(route.method, methodWidth)}${colors.reset}  ${route.path}${schemaHint(route)}`;
	});
	process.stdout.write(
		`${lines.join('\n')}\n\n${colors.dim}${sorted.length} routes · ${serverName} · \`absolute api --openapi\` for a spec${colors.reset}\n`
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

	const routes = (await fetchRoutes(server.url))?.filter(
		(route) => !isInternal(route.path)
	);
	if (!routes) {
		printDim(
			`Could not read routes from ${server.name} — the API surface needs a dev server.`
		);

		return;
	}

	if (args.includes('--openapi')) {
		process.stdout.write(
			`${JSON.stringify(buildOpenApi(routes), null, 2)}\n`
		);

		return;
	}

	if (args.includes('--json')) {
		process.stdout.write(`${JSON.stringify(routes, null, 2)}\n`);

		return;
	}

	if (routes.length === 0) {
		printDim('No routes registered.');

		return;
	}

	printSurface(routes, server.name);
};
