import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import type { SpaHost, SpaRoute } from '../utils/spaRouteTypes';

const DYNAMIC_SEGMENT_PATTERN = /^[:*]/;

const pathHasDynamic = (path: string) =>
	path
		.split('/')
		.some((seg) => DYNAMIC_SEGMENT_PATTERN.test(seg) || seg === '**');

const importsSymbolFrom = (
	sourceFile: ts.SourceFile,
	localName: string,
	moduleSpecifier: string
) => {
	for (const statement of sourceFile.statements) {
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

const readStringLiteral = (expression: ts.Expression) => {
	if (
		ts.isStringLiteral(expression) ||
		ts.isNoSubstitutionTemplateLiteral(expression)
	) {
		return expression.text;
	}

	return null;
};

const readPropertyKey = (property: ts.ObjectLiteralElementLike) => {
	if (ts.isPropertyAssignment(property)) {
		const { name } = property;
		if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
	}
	if (ts.isShorthandPropertyAssignment(property)) {
		return property.name.text;
	}

	return null;
};

const findRoutesArrayDeclaration = (
	sourceFile: ts.SourceFile,
	identifierName: string
) => {
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

	ts.forEachChild(sourceFile, visit);

	return found;
};

const extractSitemapData = (dataLiteral: ts.ObjectLiteralExpression) => {
	for (const prop of dataLiteral.properties) {
		const key = readPropertyKey(prop);
		if (key !== 'sitemap') continue;
		if (!ts.isPropertyAssignment(prop)) continue;
		const value = readStringLiteral(prop.initializer);
		if (value === 'exclude') return true;
	}

	return false;
};

const joinSegments = (parent: string, child: string) => {
	if (!child) return parent;
	if (!parent) return child;

	return `${parent.replace(/\/+$/, '')}/${child.replace(/^\/+/, '')}`;
};

const extractRoutePaths = (
	routeArray: ts.ArrayLiteralExpression,
	parentPath: string,
	parentExcluded: boolean,
	routes: SpaRoute[]
) => {
	for (const element of routeArray.elements) {
		if (!ts.isObjectLiteralExpression(element)) continue;

		let pathSegment: string | null = null;
		let redirected = false;
		let sitemapExcluded = parentExcluded;
		let childrenLiteral: ts.ArrayLiteralExpression | null = null;

		for (const property of element.properties) {
			const key = readPropertyKey(property);
			if (!key) continue;
			if (!ts.isPropertyAssignment(property)) continue;
			if (key === 'path') {
				pathSegment = readStringLiteral(property.initializer);
			} else if (key === 'redirectTo') {
				redirected = true;
			} else if (
				key === 'data' &&
				ts.isObjectLiteralExpression(property.initializer)
			) {
				if (extractSitemapData(property.initializer))
					sitemapExcluded = true;
			} else if (
				key === 'children' &&
				ts.isArrayLiteralExpression(property.initializer)
			) {
				childrenLiteral = property.initializer;
			}
		}

		if (pathSegment === null) continue;

		const joined = joinSegments(parentPath, pathSegment);

		if (childrenLiteral) {
			extractRoutePaths(childrenLiteral, joined, sitemapExcluded, routes);
			continue;
		}

		// Empty path with no children isn't a navigable URL.
		if (joined === '') continue;

		routes.push({
			dynamic: pathHasDynamic(joined),
			path: joined,
			redirected,
			sitemapExcluded
		});
	}
};

const findProvideRouterFirstArg = (sourceFile: ts.SourceFile) => {
	const result: { found: ts.Expression | null } = { found: null };

	const visit = (node: ts.Node) => {
		if (result.found) return;
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'provideRouter'
		) {
			result.found = node.arguments[0] ?? null;

			return;
		}
		ts.forEachChild(node, visit);
	};

	ts.forEachChild(sourceFile, visit);

	return result.found;
};

const findAppBaseHrefValue = (sourceFile: ts.SourceFile) => {
	let found: string | null = null;

	const visit = (node: ts.Node) => {
		if (found) return;
		if (ts.isObjectLiteralExpression(node)) {
			let isAppBaseHref = false;
			let value: string | null = null;
			for (const property of node.properties) {
				const key = readPropertyKey(property);
				if (!key) continue;
				if (!ts.isPropertyAssignment(property)) continue;
				if (
					key === 'provide' &&
					ts.isIdentifier(property.initializer) &&
					property.initializer.text === 'APP_BASE_HREF'
				) {
					isAppBaseHref = true;
				} else if (key === 'useValue') {
					value = readStringLiteral(property.initializer);
				}
			}
			if (isAppBaseHref && value !== null) {
				found = value;

				return;
			}
		}
		ts.forEachChild(node, visit);
	};

	ts.forEachChild(sourceFile, visit);

	return found;
};

const analyzeFile = async (filePath: string) => {
	let source: string;
	try {
		source = await fs.readFile(filePath, 'utf-8');
	} catch {
		return null;
	}

	// Fast pre-check to skip files that obviously aren't SPA hosts.
	if (
		!source.includes('APP_BASE_HREF') ||
		!source.includes('provideRouter')
	) {
		return null;
	}

	const sourceFile = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);

	if (!importsSymbolFrom(sourceFile, 'APP_BASE_HREF', '@angular/common'))
		return null;
	if (!importsSymbolFrom(sourceFile, 'provideRouter', '@angular/router'))
		return null;

	const baseHref = findAppBaseHrefValue(sourceFile);
	if (!baseHref) return null;

	const firstArg = findProvideRouterFirstArg(sourceFile);
	if (!firstArg) return null;

	let routesArray: ts.ArrayLiteralExpression | null = null;
	if (ts.isIdentifier(firstArg)) {
		routesArray = findRoutesArrayDeclaration(sourceFile, firstArg.text);
	} else if (ts.isArrayLiteralExpression(firstArg)) {
		routesArray = firstArg;
	}
	if (!routesArray) return null;

	const routes: SpaRoute[] = [];
	extractRoutePaths(routesArray, '', false, routes);

	return {
		baseHref,
		routes,
		sourceFile: filePath
	};
};

const walkTsFiles = async (dir: string, files: string[]) => {
	let items: import('node:fs').Dirent[];
	try {
		items = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	const directories: string[] = [];
	for (const item of items) {
		if (item.name === 'node_modules') continue;
		if (item.name.startsWith('.')) continue;
		const full = join(dir, item.name);
		if (item.isDirectory()) {
			directories.push(full);
		} else if (
			item.isFile() &&
			item.name.endsWith('.ts') &&
			!item.name.endsWith('.d.ts')
		) {
			files.push(full);
		}
	}
	await Promise.all(
		directories.map((directory) => walkTsFiles(directory, files))
	);
};

/** Statically scan an Angular page-source directory for SPA hosts —
 *  files that both import `APP_BASE_HREF`/`provideRouter` and declare
 *  an `APP_BASE_HREF` provider plus a literal `Routes` array. Returns
 *  one entry per host with the mount path and leaf routes. Does not
 *  load or execute user code. */
export const analyzeAngularSpaRoutes = async (angularDirectory: string) => {
	if (!existsSync(angularDirectory)) return [];

	const tsFiles: string[] = [];
	await walkTsFiles(angularDirectory, tsFiles);

	const pages: SpaHost[] = [];
	await Promise.all(
		tsFiles.map(async (file) => {
			try {
				const page = await analyzeFile(file);
				if (page) pages.push(page);
			} catch (err) {
				console.warn(
					`[sitemap] Angular SPA analysis failed for ${file}:`,
					err
				);
			}
		})
	);

	return pages;
};
