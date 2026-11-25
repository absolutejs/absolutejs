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
import { ts } from '../utils/lazyTypescript';
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

const readEntries = (dir: string) => {
	try {
		return readdirSync(dir, { encoding: 'utf-8', withFileTypes: true });
	} catch {
		return [];
	}
};

const isScannedDirectory = (entry: Dirent) =>
	entry.isDirectory() &&
	!SKIP_DIRS.has(entry.name) &&
	!entry.name.startsWith('.');

const collectPageFiles = (pagesRoot: string) => {
	const out: string[] = [];
	const stack: string[] = [pagesRoot];

	while (stack.length > 0) {
		const dir = stack.pop();
		if (!dir) continue;
		const entries = readEntries(dir);
		entries
			.filter(isScannedDirectory)
			.forEach((entry) => stack.push(join(dir, entry.name)));
		entries
			.filter(
				(entry) =>
					!entry.isDirectory() &&
					entry.isFile() &&
					isPageFile(entry.name)
			)
			.forEach((entry) => out.push(join(dir, entry.name)));
	}

	return out;
};

const hasTopLevelRoutesExport = (source: string, filePath: string) => {
	// Cheap pre-filter — if the file doesn't even mention `routes`, skip
	// the AST parse.
	if (!source.includes('routes')) return false;

	const sourceFile = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);

	for (const statement of sourceFile.statements) {
		if (!ts.isVariableStatement(statement)) continue;
		// Only exported declarations.
		const isExported = statement.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
		);
		if (!isExported) continue;

		const declaresRoutes = statement.declarationList.declarations.some(
			(declaration) =>
				ts.isIdentifier(declaration.name) &&
				declaration.name.text === 'routes'
		);
		if (declaresRoutes) return true;
	}

	return false;
};

const readSource = (file: string) => {
	try {
		return readFileSync(file, 'utf-8');
	} catch {
		return undefined;
	}
};

/* One page file's entry, or nothing when it cannot be read. */
const pageRoutesOf = (file: string) => {
	const source = readSource(file);
	if (source === undefined) return [];
	const base = basename(file).replace(/\.[cm]?[tj]sx?$/, '');
	const page: AngularPageRoutes = {
		hasRoutes: hasTopLevelRoutesExport(source, file),
		manifestKey: toPascal(base),
		pageFile: file
	};

	return [page];
};

export const scanAngularPageRoutes = (pagesRoot: string) =>
	collectPageFiles(pagesRoot).flatMap(pageRoutesOf);
