import type { FrameworkKey } from './frameworkKey';

// Per-framework facts the generator needs to wire a page into a routing file:
// on-disk file names, the imports the route requires, and the `.get(...)` route
// expression itself. Route expressions are emitted single-line on purpose — they
// always compile, and `absolute prettier --write` reflows them to taste.

export type ConfigDirKey =
	| 'angularDirectory'
	| 'htmlDirectory'
	| 'htmxDirectory'
	| 'reactDirectory'
	| 'svelteDirectory'
	| 'vueDirectory';

export type ImportSpec =
	| { kind: 'named'; module: string; name: string }
	| { kind: 'typeDefault'; local: string; module: string }
	| { kind: 'typeNamespace'; local: string; module: string };

export type RouteContext = {
	cssAssetKey: string;
	indexKey: string;
	manifestKey: string;
	pageSpecifier: string;
	pascal: string;
	route: string;
	title: string;
};

type FileNames = {
	kebab: string;
	pascal: string;
};

export type FrameworkDef = {
	componentFile: (names: FileNames) => string;
	configDirKey: ConfigDirKey;
	kind: 'manifest' | 'static';
	label: string;
	pageFile: (names: FileNames) => string;
	pageImportExtension: string | null;
	routeExpression: (ctx: RouteContext) => string;
	routeImports: (ctx: RouteContext) => ImportSpec[];
};

const ABS = '@absolutejs/absolute';

const reactDef: FrameworkDef = {
	configDirKey: 'reactDirectory',
	kind: 'manifest',
	label: 'React',
	pageImportExtension: null,
	componentFile: ({ pascal }) => `${pascal}.tsx`,
	pageFile: ({ pascal }) => `${pascal}.tsx`,
	routeExpression: (ctx) =>
		`.get('${ctx.route}', () => handleReactPageRequest({ Page: ${ctx.pascal}, index: asset(manifest, '${ctx.indexKey}'), props: { cssPath: asset(manifest, '${ctx.cssAssetKey}') } }))`,
	routeImports: (ctx) => [
		{ kind: 'named', module: ABS, name: 'asset' },
		{
			kind: 'named',
			module: `${ABS}/react`,
			name: 'handleReactPageRequest'
		},
		{ kind: 'named', module: ctx.pageSpecifier, name: ctx.pascal }
	]
};

const svelteDef: FrameworkDef = {
	configDirKey: 'svelteDirectory',
	kind: 'manifest',
	label: 'Svelte',
	pageImportExtension: '.svelte',
	componentFile: ({ pascal }) => `${pascal}.svelte`,
	pageFile: ({ pascal }) => `${pascal}.svelte`,
	routeExpression: (ctx) =>
		`.get('${ctx.route}', () => handleSveltePageRequest<typeof ${ctx.pascal}>({ indexPath: asset(manifest, '${ctx.indexKey}'), pagePath: asset(manifest, '${ctx.manifestKey}'), props: { cssPath: asset(manifest, '${ctx.cssAssetKey}') } }))`,
	routeImports: (ctx) => [
		{ kind: 'named', module: ABS, name: 'asset' },
		{
			kind: 'named',
			module: `${ABS}/svelte`,
			name: 'handleSveltePageRequest'
		},
		{ kind: 'typeDefault', local: ctx.pascal, module: ctx.pageSpecifier }
	]
};

const vueDef: FrameworkDef = {
	configDirKey: 'vueDirectory',
	kind: 'manifest',
	label: 'Vue',
	pageImportExtension: '.vue',
	componentFile: ({ pascal }) => `${pascal}.vue`,
	pageFile: ({ pascal }) => `${pascal}.vue`,
	routeExpression: (ctx) =>
		`.get('${ctx.route}', () => handleVuePageRequest<typeof ${ctx.pascal}>({ headTag: generateHeadElement({ cssPath: asset(manifest, '${ctx.cssAssetKey}'), title: '${ctx.title}' }), indexPath: asset(manifest, '${ctx.indexKey}'), pagePath: asset(manifest, '${ctx.manifestKey}'), props: {} }))`,
	routeImports: (ctx) => [
		{ kind: 'named', module: ABS, name: 'asset' },
		{ kind: 'named', module: ABS, name: 'generateHeadElement' },
		{ kind: 'named', module: `${ABS}/vue`, name: 'handleVuePageRequest' },
		{ kind: 'typeDefault', local: ctx.pascal, module: ctx.pageSpecifier }
	]
};

const angularDef: FrameworkDef = {
	configDirKey: 'angularDirectory',
	kind: 'manifest',
	label: 'Angular',
	pageImportExtension: null,
	componentFile: ({ kebab }) => `${kebab}.component.ts`,
	pageFile: ({ kebab }) => `${kebab}.ts`,
	routeExpression: (ctx) =>
		`.get('${ctx.route}', ({ request }) => handleAngularPageRequest<${ctx.pascal}Page.Context>({ headTag: generateHeadElement({ cssPath: asset(manifest, '${ctx.cssAssetKey}'), title: '${ctx.title}' }), indexPath: asset(manifest, '${ctx.indexKey}'), pagePath: asset(manifest, '${ctx.manifestKey}'), request, requestContext: {} }))`,
	routeImports: (ctx) => [
		{ kind: 'named', module: ABS, name: 'asset' },
		{ kind: 'named', module: ABS, name: 'generateHeadElement' },
		{
			kind: 'named',
			module: `${ABS}/angular`,
			name: 'handleAngularPageRequest'
		},
		{
			kind: 'typeNamespace',
			local: `${ctx.pascal}Page`,
			module: ctx.pageSpecifier
		}
	]
};

const htmlDef: FrameworkDef = {
	configDirKey: 'htmlDirectory',
	kind: 'static',
	label: 'HTML',
	pageImportExtension: null,
	componentFile: ({ pascal }) => `${pascal}.html`,
	pageFile: ({ pascal }) => `${pascal}.html`,
	routeExpression: (ctx) =>
		`.get('${ctx.route}', () => handleHTMLPageRequest(asset(manifest, '${ctx.manifestKey}')))`,
	routeImports: () => [
		{ kind: 'named', module: ABS, name: 'asset' },
		{ kind: 'named', module: ABS, name: 'handleHTMLPageRequest' }
	]
};

const htmxDef: FrameworkDef = {
	configDirKey: 'htmxDirectory',
	kind: 'static',
	label: 'HTMX',
	pageImportExtension: null,
	componentFile: ({ pascal }) => `${pascal}.html`,
	pageFile: ({ pascal }) => `${pascal}.html`,
	routeExpression: (ctx) =>
		`.get('${ctx.route}', () => handleHTMXPageRequest(asset(manifest, '${ctx.manifestKey}')))`,
	routeImports: () => [
		{ kind: 'named', module: ABS, name: 'asset' },
		{ kind: 'named', module: ABS, name: 'handleHTMXPageRequest' }
	]
};

export const frameworks: Record<FrameworkKey, FrameworkDef> = {
	angular: angularDef,
	html: htmlDef,
	htmx: htmxDef,
	react: reactDef,
	svelte: svelteDef,
	vue: vueDef
};
