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
		const { name } = property;
		if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
	}
	if (ts.isShorthandPropertyAssignment(property)) {
		return property.name.text;
	}

	return null;
};

const importsSymbolFrom = (
	sf: ts.SourceFile,
	localName: string,
	moduleSpecifier: string
): boolean => {
	for (const statement of sf.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
		if (statement.moduleSpecifier.text !== moduleSpecifier) continue;
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

		for (const property of element.properties) {
			const key = readPropertyKey(property);
			if (!key) continue;
			if (!ts.isPropertyAssignment(property)) continue;
			if (key === 'path') {
				pathSegment = readStringLiteral(property.initializer);
			} else if (key === 'redirect') {
				redirected = true;
			} else if (
				key === 'children' &&
				ts.isArrayLiteralExpression(property.initializer)
			) {
				childrenLiteral = property.initializer;
			} else if (
				key === 'meta' &&
				ts.isObjectLiteralExpression(property.initializer)
			) {
				for (const metaProp of property.initializer.properties) {
					const metaKey = readPropertyKey(metaProp);
					if (metaKey !== 'sitemap') continue;
					if (!ts.isPropertyAssignment(metaProp)) continue;
					const value = readStringLiteral(metaProp.initializer);
					if (value === 'exclude') sitemapExcluded = true;
				}
			}
		}

		if (pathSegment === null) continue;

		const joined = joinSegments(parentPath, pathSegment);

		if (childrenLiteral) {
			extractRouteEntries(childrenLiteral, joined, out);
			continue;
		}

		if (redirected) continue;
		if (joined === '') continue;

		out.push({
			dynamic: pathHasDynamic(joined),
			path: joined,
			redirected,
			sitemapExcluded
		});
	}
};

const findCreateRouterCall = (sf: ts.SourceFile): ts.CallExpression | null => {
	let found: ts.CallExpression | null = null;
	const visit = (node: ts.Node) => {
		if (found) return;
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'createRouter'
		) {
			found = node;

			return;
		}
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(sf, visit);

	return found;
};

const findCreateWebHistoryBase = (sf: ts.SourceFile): string | null => {
	let found: string | null = null;
	const visit = (node: ts.Node) => {
		if (found) return;
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			(node.expression.text === 'createWebHistory' ||
				node.expression.text === 'createWebHashHistory')
		) {
			const baseArg = node.arguments[0];
			if (baseArg) {
				const text = readStringLiteral(baseArg);
				if (text !== null) {
					found = text;

					return;
				}
			} else {
				// No arg means base = '/'
				found = '/';

				return;
			}
		}
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(sf, visit);

	return found;
};

const readRoutesFromCreateRouterOptions = (
	sf: ts.SourceFile,
	optionsExpr: ts.Expression
): ts.ArrayLiteralExpression | null => {
	if (!ts.isObjectLiteralExpression(optionsExpr)) return null;
	for (const property of optionsExpr.properties) {
		const key = readPropertyKey(property);
		if (key !== 'routes') continue;
		if (ts.isShorthandPropertyAssignment(property)) {
			return findVariableArrayDeclaration(sf, property.name.text);
		}
		if (!ts.isPropertyAssignment(property)) continue;
		if (ts.isArrayLiteralExpression(property.initializer)) {
			return property.initializer;
		}
		if (ts.isIdentifier(property.initializer)) {
			return findVariableArrayDeclaration(sf, property.initializer.text);
		}
	}

	return null;
};

const extractScriptBlockFromVueSfc = (source: string): string | null => {
	// Crude but effective: capture the first `<script setup>` or `<script>` block.
	const scriptRe = /<script\b[^>]*?(?:setup)?[^>]*>([\s\S]*?)<\/script>/i;
	const match = scriptRe.exec(source);

	return match ? (match[1] ?? null) : null;
};

const analyzeFile = async (filePath: string): Promise<SpaHost | null> => {
	let source: string;
	try {
		source = await fs.readFile(filePath, 'utf-8');
	} catch {
		return null;
	}

	let analysisSource = source;
	if (filePath.endsWith('.vue')) {
		const script = extractScriptBlockFromVueSfc(source);
		if (script === null) return null;
		analysisSource = script;
	}

	if (!analysisSource.includes('createRouter')) return null;

	const sf = ts.createSourceFile(
		filePath,
		analysisSource,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);

	if (!importsSymbolFrom(sf, 'createRouter', 'vue-router')) return null;

	const call = findCreateRouterCall(sf);
	if (!call) return null;

	const optionsArg = call.arguments[0];
	if (!optionsArg) return null;

	const routesArray = readRoutesFromCreateRouterOptions(sf, optionsArg);
	if (!routesArray) return null;

	const base = findCreateWebHistoryBase(sf) ?? '/';
	const baseHref = base.endsWith('/') ? base : `${base}/`;

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
			(item.name.endsWith('.ts') ||
				item.name.endsWith('.js') ||
				item.name.endsWith('.vue')) &&
			!item.name.endsWith('.d.ts')
		) {
			out.push(full);
		}
	}
};

/** Statically scan a Vue page-source directory for SPA hosts — files
 *  that call `createRouter({ history: createWebHistory('/...'), routes })`
 *  from `vue-router`. The `createWebHistory` argument supplies the mount
 *  path; the `routes` option supplies the route table (inline array or
 *  identifier reference). Scans `.vue` SFC script blocks too. */
export const analyzeVueSpaRoutes = async (
	vueDirectory: string
): Promise<SpaHost[]> => {
	if (!existsSync(vueDirectory)) return [];

	const files: string[] = [];
	await walkSourceFiles(vueDirectory, files);

	const hosts: SpaHost[] = [];
	await Promise.all(
		files.map(async (file) => {
			try {
				const host = await analyzeFile(file);
				if (host) hosts.push(host);
			} catch (err) {
				console.warn(
					`[sitemap] Vue SPA analysis failed for ${file}:`,
					err
				);
			}
		})
	);

	return hosts;
};
