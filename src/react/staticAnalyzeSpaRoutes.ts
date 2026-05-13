import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import type { SpaHost, SpaRoute } from '../utils/spaRouteTypes';

const DYNAMIC_SEGMENT_PATTERN = /^[:*]/;

const pathHasDynamic = (path: string) =>
	path
		.split('/')
		.some((seg) => DYNAMIC_SEGMENT_PATTERN.test(seg) || seg === '**');

const readStringLiteral = (expression: ts.Expression): string | null => {
	if (
		ts.isStringLiteral(expression) ||
		ts.isNoSubstitutionTemplateLiteral(expression)
	) {
		return expression.text;
	}

	return null;
};

const readPropertyKey = (
	property: ts.ObjectLiteralElementLike
): string | null => {
	if (ts.isPropertyAssignment(property)) {
		const name = property.name;
		if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
	}
	if (ts.isShorthandPropertyAssignment(property)) {
		return property.name.text;
	}

	return null;
};

const importsSymbolFromAny = (
	sf: ts.SourceFile,
	localName: string,
	moduleSpecifiers: string[]
): boolean => {
	for (const statement of sf.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
		if (!moduleSpecifiers.includes(statement.moduleSpecifier.text))
			continue;
		const named = statement.importClause?.namedBindings;
		if (!named || !ts.isNamedImports(named)) continue;
		for (const element of named.elements) {
			if (element.name.text === localName) return true;
		}
	}

	return false;
};

const findVariableArrayDeclaration = (
	sf: ts.SourceFile,
	identifierName: string
): ts.ArrayLiteralExpression | null => {
	let found: ts.ArrayLiteralExpression | null = null;
	const visit = (node: ts.Node) => {
		if (found) return;
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === identifierName &&
			node.initializer &&
			ts.isArrayLiteralExpression(node.initializer)
		) {
			found = node.initializer;

			return;
		}
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(sf, visit);

	return found;
};

const joinSegments = (parent: string, child: string): string => {
	if (!child) return parent;
	if (!parent) return child;

	return `${parent.replace(/\/+$/, '')}/${child.replace(/^\/+/, '')}`;
};

const extractRouteEntries = (
	arr: ts.ArrayLiteralExpression,
	parentPath: string,
	out: SpaRoute[]
): void => {
	for (const element of arr.elements) {
		if (!ts.isObjectLiteralExpression(element)) continue;

		let pathSegment: string | null = null;
		let redirected = false;
		let sitemapExcluded = false;
		let childrenLiteral: ts.ArrayLiteralExpression | null = null;
		let isIndex = false;

		for (const property of element.properties) {
			const key = readPropertyKey(property);
			if (!key) continue;
			if (!ts.isPropertyAssignment(property)) continue;
			if (key === 'path') {
				pathSegment = readStringLiteral(property.initializer);
			} else if (key === 'index') {
				isIndex = true;
			} else if (key === 'loader' || key === 'lazy') {
				// no-op — supported but doesn't change path
			} else if (
				key === 'children' &&
				ts.isArrayLiteralExpression(property.initializer)
			) {
				childrenLiteral = property.initializer;
			} else if (key === 'redirectTo') {
				redirected = true;
			} else if (
				key === 'handle' &&
				ts.isObjectLiteralExpression(property.initializer)
			) {
				// React Router uses `handle` for route-level metadata.
				for (const handleProp of property.initializer.properties) {
					const handleKey = readPropertyKey(handleProp);
					if (handleKey !== 'sitemap') continue;
					if (!ts.isPropertyAssignment(handleProp)) continue;
					const value = readStringLiteral(handleProp.initializer);
					if (value === 'exclude') sitemapExcluded = true;
				}
			}
		}

		// `path` is optional in React Router for layout/index routes.
		const segment = pathSegment ?? '';
		const joined = joinSegments(parentPath, segment);

		if (childrenLiteral) {
			extractRouteEntries(childrenLiteral, joined, out);
			continue;
		}

		if (redirected) continue;
		if (!isIndex && pathSegment === null) continue;
		if (joined === '') continue;

		out.push({
			dynamic: pathHasDynamic(joined),
			path: joined,
			redirected,
			sitemapExcluded
		});
	}
};

const findCreateBrowserRouterCall = (
	sf: ts.SourceFile
): ts.CallExpression | null => {
	let found: ts.CallExpression | null = null;
	const visit = (node: ts.Node) => {
		if (found) return;
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'createBrowserRouter'
		) {
			found = node;

			return;
		}
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(sf, visit);

	return found;
};

const readBasenameFromOptions = (
	expression: ts.Expression | undefined
): string | null => {
	if (!expression || !ts.isObjectLiteralExpression(expression)) return null;
	for (const property of expression.properties) {
		const key = readPropertyKey(property);
		if (key !== 'basename') continue;
		if (!ts.isPropertyAssignment(property)) continue;
		const value = readStringLiteral(property.initializer);
		if (value !== null) return value;
	}

	return null;
};

const analyzeFile = async (filePath: string): Promise<SpaHost | null> => {
	let source: string;
	try {
		source = await fs.readFile(filePath, 'utf-8');
	} catch {
		return null;
	}

	if (!source.includes('createBrowserRouter')) return null;

	const sf = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
	);

	if (
		!importsSymbolFromAny(sf, 'createBrowserRouter', [
			'react-router-dom',
			'react-router'
		])
	) {
		return null;
	}

	const call = findCreateBrowserRouterCall(sf);
	if (!call) return null;

	const routesArg = call.arguments[0];
	if (!routesArg) return null;

	let routesArray: ts.ArrayLiteralExpression | null = null;
	if (ts.isArrayLiteralExpression(routesArg)) {
		routesArray = routesArg;
	} else if (ts.isIdentifier(routesArg)) {
		routesArray = findVariableArrayDeclaration(sf, routesArg.text);
	}
	if (!routesArray) return null;

	const basename = readBasenameFromOptions(call.arguments[1]);
	const baseHref = basename ? `${basename.replace(/\/+$/, '')}/` : '/';

	const routes: SpaRoute[] = [];
	extractRouteEntries(routesArray, '', routes);

	return { baseHref, routes, sourceFile: filePath };
};

const walkSourceFiles = async (dir: string, out: string[]): Promise<void> => {
	let items: import('node:fs').Dirent[];
	try {
		items = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const item of items) {
		if (item.name === 'node_modules' || item.name.startsWith('.')) continue;
		const full = join(dir, item.name);
		if (item.isDirectory()) {
			await walkSourceFiles(full, out);
		} else if (
			item.isFile() &&
			(item.name.endsWith('.tsx') ||
				item.name.endsWith('.ts') ||
				item.name.endsWith('.jsx') ||
				item.name.endsWith('.js')) &&
			!item.name.endsWith('.d.ts')
		) {
			out.push(full);
		}
	}
};

/** Statically scan a React page-source directory for SPA hosts —
 *  files that call `createBrowserRouter(routes, { basename })` from
 *  `react-router-dom`. The first argument supplies the routes (inline
 *  array or identifier reference), the second arg's `basename`
 *  supplies the mount path. */
export const analyzeReactSpaRoutes = async (
	reactDirectory: string
): Promise<SpaHost[]> => {
	if (!existsSync(reactDirectory)) return [];

	const files: string[] = [];
	await walkSourceFiles(reactDirectory, files);

	const hosts: SpaHost[] = [];
	await Promise.all(
		files.map(async (file) => {
			try {
				const host = await analyzeFile(file);
				if (host) hosts.push(host);
			} catch (err) {
				console.warn(
					`[sitemap] React SPA analysis failed for ${file}:`,
					err
				);
			}
		})
	);

	return hosts;
};
