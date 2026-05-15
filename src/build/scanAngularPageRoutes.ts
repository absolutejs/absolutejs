/* Build-time scan: for each Angular page source file under the
 * configured `angularDirectory`, detect whether the module declares an
 * `export const routes: Routes = [...]` (or `let`/`var`) at the top
 * level. The framework auto-wires `provideRouter(routes, ...)` into
 * the page's bootstrap providers when found — same pattern Angular
 * apps already use to declare router config (e.g. `app.routes.ts`),
 * so the export name isn't a framework invention.
 *
 * Returns the file path → manifest-key mapping for each page. The
 * downstream emitter pairs each entry with the providers expression
 * and the inferred APP_BASE_HREF. */

import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { basename, join } from 'node:path';
import ts from 'typescript';
import { toPascal } from '../utils/stringModifiers';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const SKIP_DIRS = new Set([
	'.absolutejs',
	'.generated',
	'.git',
	'build',
	'compiled',
	'dist',
	'node_modules'
]);

export type AngularPageRoutes = {
	/** Absolute path of the page module. */
	pageFile: string;
	/** Manifest key (PascalCase of basename) — `home/home.ts` → `Home`. */
	manifestKey: string;
	/** True when the page module top-level declares
	 *  `export const routes` (or `let`/`var`). */
	hasRoutes: boolean;
};

const hasSourceExtension = (filePath: string) => {
	const idx = filePath.lastIndexOf('.');
	if (idx === -1) return false;

	return SOURCE_EXTENSIONS.has(filePath.slice(idx));
};

const isPageFile = (filePath: string) => {
	if (!hasSourceExtension(filePath)) return false;
	const base = basename(filePath);
	if (base.endsWith('.d.ts')) return false;
	if (base.endsWith('.test.ts')) return false;
	if (base.endsWith('.spec.ts')) return false;

	return true;
};

const collectPageFiles = (pagesRoot: string): string[] => {
	const out: string[] = [];
	const stack: string[] = [pagesRoot];

	while (stack.length > 0) {
		const dir = stack.pop();
		if (!dir) continue;

		let entries: Dirent[];
		try {
			entries = readdirSync(dir, {
				encoding: 'utf-8',
				withFileTypes: true
			});
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				if (entry.name.startsWith('.')) continue;
				stack.push(join(dir, entry.name));
			} else if (entry.isFile() && isPageFile(entry.name)) {
				out.push(join(dir, entry.name));
			}
		}
	}

	return out;
};

const hasTopLevelRoutesExport = (source: string, filePath: string) => {
	// Cheap pre-filter — if the file doesn't even mention `routes`, skip
	// the AST parse.
	if (!source.includes('routes')) return false;

	const sf = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);

	for (const statement of sf.statements) {
		if (!ts.isVariableStatement(statement)) continue;
		// Only exported declarations.
		const isExported = statement.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
		);
		if (!isExported) continue;

		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name)) continue;
			if (declaration.name.text === 'routes') return true;
		}
	}

	return false;
};

export const scanAngularPageRoutes = (
	pagesRoot: string
): AngularPageRoutes[] => {
	const files = collectPageFiles(pagesRoot);
	const out: AngularPageRoutes[] = [];

	for (const file of files) {
		let source: string;
		try {
			source = readFileSync(file, 'utf-8');
		} catch {
			continue;
		}

		const hasRoutes = hasTopLevelRoutesExport(source, file);
		const base = basename(file).replace(/\.[cm]?[tj]sx?$/, '');
		const manifestKey = toPascal(base);
		out.push({
			hasRoutes,
			manifestKey,
			pageFile: file
		});
	}

	return out;
};

