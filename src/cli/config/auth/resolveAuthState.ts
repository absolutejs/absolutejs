import ts from 'typescript';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { AUTH_FEATURES } from './authCatalog';
import { isScaffoldableFeature } from './authScaffolds';
import { resolveAuthSettingsState } from './resolveAuthSettings';
import type { AuthPanelState } from '../../../../types/authPanel';

const AUTH_PACKAGE = '@absolutejs/auth';
const REPO_URL = 'https://github.com/absolutejs/absolute-auth';
const NPM_URL = 'https://www.npmjs.com/package/@absolutejs/auth';
const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'build',
	'dist',
	'.absolutejs',
	'coverage',
	'.next'
]);
const MAX_FILES = 4000;
// The setup function is `auth` in current releases and `absoluteAuth` in older
// ones — match either so the panel introspects both.
const SETUP_EXPORTS = new Set(['auth', 'absoluteAuth']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const readJson = (path: string) => {
	if (!existsSync(path)) return null;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));

		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
};

const stringField = (record: Record<string, unknown> | null, key: string) => {
	const value = record?.[key];

	return typeof value === 'string' ? value : null;
};

const declaredVersionFor = (cwd: string) => {
	const pkg = readJson(join(cwd, 'package.json'));
	if (!pkg) return null;
	for (const field of ['dependencies', 'devDependencies']) {
		const group = pkg[field];
		if (!isRecord(group)) continue;
		const version = group[AUTH_PACKAGE];
		if (typeof version === 'string') return version;
	}

	return null;
};

const installedVersionFor = (cwd: string) =>
	stringField(
		readJson(join(cwd, 'node_modules', AUTH_PACKAGE, 'package.json')),
		'version'
	);

const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|mjs)$/;

const safeReaddir = (dir: string) => {
	try {
		return readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
};

type DirEntry = {
	isDirectory: () => boolean;
	name: string;
};

// Sort one directory entry into either a source file (`found`) or a sub-directory
// to descend into (`dirs`), skipping ignored + hidden directories.
const sortEntry = (
	dir: string,
	entry: DirEntry,
	found: string[],
	dirs: string[]
) => {
	const full = join(dir, entry.name);
	if (entry.isDirectory()) {
		if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) return;
		dirs.push(full);

		return;
	}
	if (SOURCE_FILE.test(entry.name)) found.push(full);
};

const collectFrom = (dir: string, found: string[], stack: string[]) => {
	for (const entry of safeReaddir(dir)) sortEntry(dir, entry, found, stack);
};

// Source files that even mention the package — the only ones worth parsing.
const candidateFiles = (root: string) => {
	const found: string[] = [];
	const stack = [root];
	while (stack.length > 0 && found.length < MAX_FILES) {
		const dir = stack.pop();
		if (dir === undefined) break;
		collectFrom(dir, found, stack);
	}

	return found;
};

const isAuthPackageImport = (
	statement: ts.Statement
): statement is ts.ImportDeclaration =>
	ts.isImportDeclaration(statement) &&
	ts.isStringLiteral(statement.moduleSpecifier) &&
	statement.moduleSpecifier.text === AUTH_PACKAGE;

// Add the local name(s) bound to the package's `auth` export by one import.
const addAuthNames = (statement: ts.ImportDeclaration, names: Set<string>) => {
	const bindings = statement.importClause?.namedBindings;
	if (!bindings || !ts.isNamedImports(bindings)) return;
	for (const element of bindings.elements) {
		const imported = element.propertyName?.text ?? element.name.text;
		if (!SETUP_EXPORTS.has(imported)) continue;
		names.add(element.name.text);
	}
};

// Local name(s) bound to the package's `auth` export in this file.
const authBindings = (sourceFile: ts.SourceFile) => {
	const names = new Set<string>();
	for (const statement of sourceFile.statements) {
		if (isAuthPackageImport(statement)) addAuthNames(statement, names);
	}

	return names;
};

const isAuthCall = (node: ts.CallExpression, bindings: Set<string>) =>
	ts.isIdentifier(node.expression) && bindings.has(node.expression.text);

const providerCountOf = (property: ts.ObjectLiteralElementLike) => {
	if (
		!ts.isPropertyAssignment(property) ||
		!ts.isObjectLiteralExpression(property.initializer)
	) {
		return null;
	}

	return property.initializer.properties.length;
};

const readConfigKeys = (object: ts.ObjectLiteralExpression) => {
	const keys = new Set<string>();
	let providerCount: number | null = null;
	const usesSpread = object.properties.some((property) =>
		ts.isSpreadAssignment(property)
	);
	for (const property of object.properties) {
		const { name } = property;
		if (name === undefined || !ts.isIdentifier(name)) continue;
		keys.add(name.text);
		if (name.text !== 'providersConfiguration') continue;
		providerCount = providerCountOf(property);
	}

	return { keys, providerCount, usesSpread };
};

type SetupMatch = {
	keys: Set<string>;
	providerCount: number | null;
	usesSpread: boolean;
};

const matchFromCall = (node: ts.CallExpression): SetupMatch => {
	const [arg] = node.arguments;
	if (arg && ts.isObjectLiteralExpression(arg)) return readConfigKeys(arg);

	return { keys: new Set(), providerCount: null, usesSpread: true };
};

const readFileOrNull = (path: string) => {
	try {
		return readFileSync(path, 'utf-8');
	} catch {
		return null;
	}
};

// Return type is annotated because `match` is assigned inside the `visit`
// closure, which TS's flow analysis ignores when inferring (it would infer
// `null`) — same reason `findConfigObject` annotates its result.
const findSetupInFile = (path: string): SetupMatch | null => {
	const text = readFileOrNull(path);
	if (text === null || !text.includes(AUTH_PACKAGE)) return null;
	const sourceFile = ts.createSourceFile(
		path,
		text,
		ts.ScriptTarget.Latest,
		true
	);
	const bindings = authBindings(sourceFile);
	if (bindings.size === 0) return null;

	let match: SetupMatch | null = null;
	const visit = (node: ts.Node) => {
		if (match) return;
		if (ts.isCallExpression(node) && isAuthCall(node, bindings)) {
			match = matchFromCall(node);

			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	return match;
};

const featureStatuses = (keys: Set<string>) =>
	AUTH_FEATURES.map((feature) => ({
		blurb: feature.blurb,
		configKey: feature.configKey,
		configured: keys.has(feature.configKey),
		id: feature.id,
		kind: feature.kind,
		label: feature.label,
		scaffoldable: isScaffoldableFeature(feature.id)
	}));

export const resolveAuthState = (cwd: string) => {
	const installedVersion = installedVersionFor(cwd);
	const root = existsSync(join(cwd, 'src')) ? join(cwd, 'src') : cwd;

	let match: SetupMatch | null = null;
	let setupPath: string | null = null;
	for (const file of candidateFiles(root)) {
		const found = findSetupInFile(file);
		if (found === null) continue;
		match = found;
		setupPath = relative(cwd, resolve(file));
		break;
	}

	const keys = match?.keys ?? new Set<string>();
	const state: AuthPanelState = {
		declaredVersion: declaredVersionFor(cwd),
		features: featureStatuses(keys),
		installed: installedVersion !== null,
		installedVersion,
		introspected: match !== null,
		npmUrl: NPM_URL,
		providerCount: match?.providerCount ?? null,
		repoUrl: REPO_URL,
		settings: resolveAuthSettingsState(cwd),
		setupPath,
		usesSpread: match?.usesSpread ?? false
	};

	return state;
};
