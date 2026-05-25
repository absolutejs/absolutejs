import ts from 'typescript';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { toModuleSpecifier } from './context';
import type { FrameworkDef, ImportSpec, RouteContext } from './frameworks';

// Wires a generated page/api route into the project's Elysia chain using the TS
// compiler API: it finds the chain (in pagesPlugin.ts if present, else the server
// entry), inserts the required imports (merging into existing declarations), and
// splices the new `.get(...)` call at the correct point — at the end of a routes
// plugin, or before `.use(networking)` / `.use(absolutejs)` / `.on('error')` in
// an inline server. If the file doesn't match the expected shape it returns a
// snippet to paste instead, so we never corrupt a customized file.

type Edit = { end: number; start: number; text: string };

const DEFAULT_SEPARATOR = '\n\t\t';
const BOUNDARY_USE = new Set(['absolutejs', 'networking']);

const applyEdits = (text: string, edits: Edit[]) => {
	const ordered = [...edits].sort(
		(first, second) => second.start - first.start
	);
	let output = text;
	for (const edit of ordered) {
		output =
			output.slice(0, edit.start) + edit.text + output.slice(edit.end);
	}

	return output;
};

const stripExtension = (path: string) => path.replace(/\.[^./\\]+$/, '');

const parse = (path: string, text: string) =>
	ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);

const findElysiaNew = (sourceFile: ts.SourceFile) => {
	let found: ts.NewExpression | null = null;
	const visit = (node: ts.Node) => {
		if (found) return;
		if (
			ts.isNewExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'Elysia'
		) {
			found = node;

			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	return found;
};

const climbChain = (start: ts.Expression) => {
	let top = start;
	while (
		ts.isPropertyAccessExpression(top.parent) &&
		top.parent.expression === top &&
		ts.isCallExpression(top.parent.parent) &&
		top.parent.parent.expression === top.parent
	) {
		top = top.parent.parent;
	}

	return top;
};

const collectCalls = (top: ts.Expression) => {
	const calls: ts.CallExpression[] = [];
	let node = top;
	while (
		ts.isCallExpression(node) &&
		ts.isPropertyAccessExpression(node.expression)
	) {
		calls.push(node);
		node = node.expression.expression;
	}

	return calls.reverse();
};

const methodName = (call: ts.CallExpression) =>
	ts.isPropertyAccessExpression(call.expression)
		? call.expression.name.text
		: null;

const isBoundary = (call: ts.CallExpression) => {
	const name = methodName(call);
	const [arg] = call.arguments;
	if (name === 'use' && arg && ts.isIdentifier(arg)) {
		return BOUNDARY_USE.has(arg.text);
	}

	return name === 'on' && arg !== undefined && ts.isStringLiteralLike(arg);
};

const receiverEnd = (call: ts.CallExpression) =>
	ts.isPropertyAccessExpression(call.expression)
		? call.expression.expression.getEnd()
		: call.getEnd();

// The whitespace (newline + indent) that precedes a chained `.method` — reused
// so the inserted route lines up with the existing chain regardless of style.
const separatorBefore = (text: string, offset: number) => {
	const match = text.slice(offset).match(/^(\s*\n[ \t]*)\./);

	return match ? match[1] : DEFAULT_SEPARATOR;
};

const findRouteInsertion = (text: string, top: ts.Expression) => {
	const calls = collectCalls(top);
	const boundary = calls.find(isBoundary);
	if (boundary) {
		const offset = receiverEnd(boundary);

		return { offset, separator: separatorBefore(text, offset) };
	}
	const last = calls[calls.length - 1];
	const offset = last ? last.getEnd() : top.getEnd();
	const sepProbe = last ? receiverEnd(last) : top.getEnd();

	return { offset, separator: separatorBefore(text, sepProbe) };
};

const namedImportDecl = (sourceFile: ts.SourceFile, module: string) =>
	sourceFile.statements.find(
		(statement): statement is ts.ImportDeclaration =>
			ts.isImportDeclaration(statement) &&
			ts.isStringLiteral(statement.moduleSpecifier) &&
			statement.moduleSpecifier.text === module &&
			statement.importClause !== undefined &&
			!statement.importClause.isTypeOnly &&
			statement.importClause.namedBindings !== undefined &&
			ts.isNamedImports(statement.importClause.namedBindings)
	);

const importedNames = (decl: ts.ImportDeclaration) => {
	const bindings = decl.importClause?.namedBindings;
	if (!bindings || !ts.isNamedImports(bindings)) return new Set<string>();

	return new Set(
		bindings.elements.map(
			(element) => (element.propertyName ?? element.name).text
		)
	);
};

const lastImportEnd = (sourceFile: ts.SourceFile) => {
	let end = 0;
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) end = statement.getEnd();
	}

	return end;
};

const hasTypeImport = (
	sourceFile: ts.SourceFile,
	module: string,
	local: string
) =>
	sourceFile.statements.some(
		(statement) =>
			ts.isImportDeclaration(statement) &&
			ts.isStringLiteral(statement.moduleSpecifier) &&
			statement.moduleSpecifier.text === module &&
			statement.getText().includes(local)
	);

const renderTypeImport = (spec: ImportSpec) => {
	if (spec.kind === 'typeDefault') {
		return `import type ${spec.local} from '${spec.module}';`;
	}
	if (spec.kind === 'typeNamespace') {
		return `import type * as ${spec.local} from '${spec.module}';`;
	}

	return '';
};

const groupNamed = (specs: ImportSpec[]) => {
	const byModule = new Map<string, Set<string>>();
	for (const spec of specs) {
		if (spec.kind !== 'named') continue;
		const set = byModule.get(spec.module) ?? new Set<string>();
		set.add(spec.name);
		byModule.set(spec.module, set);
	}

	return byModule;
};

const mergeNamedEdit = (
	decl: ts.ImportDeclaration,
	sourceFile: ts.SourceFile,
	missing: string[]
) => {
	const bindings = decl.importClause?.namedBindings;
	if (!bindings || !ts.isNamedImports(bindings)) return null;
	const { elements } = bindings;
	const additions = missing.join(', ');
	if (elements.length === 0) {
		const insertAt = bindings.getStart(sourceFile) + 1;

		return { end: insertAt, start: insertAt, text: additions };
	}
	const last = elements[elements.length - 1];
	if (!last) return null;
	const insertAt = last.getEnd();

	return { end: insertAt, start: insertAt, text: `, ${additions}` };
};

const missingNamesEdit = (
	decl: ts.ImportDeclaration,
	sourceFile: ts.SourceFile,
	names: Set<string>
) => {
	const existing = importedNames(decl);
	const missing = [...names].filter((name) => !existing.has(name));

	return missing.length ? mergeNamedEdit(decl, sourceFile, missing) : null;
};

// Builds the set of text edits that add every required import — merging named
// imports into an existing declaration for the same module when possible, and
// appending new declarations (named + type) after the last import otherwise.
const buildImportEdits = (sourceFile: ts.SourceFile, specs: ImportSpec[]) => {
	const edits: Edit[] = [];
	const newLines: string[] = [];
	for (const [module, names] of groupNamed(specs)) {
		const decl = namedImportDecl(sourceFile, module);
		const edit = decl ? missingNamesEdit(decl, sourceFile, names) : null;
		if (edit) edits.push(edit);
		const fresh = `import { ${[...names].join(', ')} } from '${module}';`;
		if (!decl) newLines.push(fresh);
	}
	for (const spec of specs) {
		if (spec.kind === 'named') continue;
		if (hasTypeImport(sourceFile, spec.module, spec.local)) continue;
		newLines.push(renderTypeImport(spec));
	}
	if (newLines.length > 0) {
		const insertAt = lastImportEnd(sourceFile);
		edits.push({
			end: insertAt,
			start: insertAt,
			text: `\n${newLines.join('\n')}`
		});
	}

	return edits;
};

const renderImportBlock = (specs: ImportSpec[]) => {
	const lines: string[] = [];
	for (const [module, names] of groupNamed(specs)) {
		lines.push(`import { ${[...names].join(', ')} } from '${module}';`);
	}
	for (const spec of specs) {
		if (spec.kind !== 'named') lines.push(renderTypeImport(spec));
	}

	return lines.join('\n');
};

export type WireInput = {
	cssAssetKey: string;
	def: FrameworkDef;
	indexKey: string;
	manifestKey: string;
	pageFileAbs: string;
	pascal: string;
	route: string;
	serverEntry: string;
	title: string;
};

export type WireResult =
	| { kind: 'edited'; routingFile: string }
	| { kind: 'manual'; reason: string; snippet: string };

const hasChain = (path: string) => {
	if (!existsSync(path)) return false;
	const sourceFile = parse(path, readFileSync(path, 'utf-8'));
	const found = findElysiaNew(sourceFile);

	return found !== null;
};

const firstChainFile = (pluginsDir: string) => {
	if (!existsSync(pluginsDir)) return null;
	for (const name of readdirSync(pluginsDir)) {
		if (!name.endsWith('.ts')) continue;
		const candidate = join(pluginsDir, name);
		if (hasChain(candidate)) return candidate;
	}

	return null;
};

export const findRoutingFile = (serverEntry: string) => {
	const pluginsDir = join(dirname(serverEntry), 'plugins');
	const preferred = join(pluginsDir, 'pagesPlugin.ts');
	if (hasChain(preferred)) return preferred;
	const scanned = firstChainFile(pluginsDir);
	if (scanned) return scanned;
	if (hasChain(serverEntry)) return serverEntry;

	return null;
};

const buildRouteContext = (input: WireInput, routingFile: string) => {
	const specifier = `${toModuleSpecifier(
		dirname(routingFile),
		stripExtension(input.pageFileAbs)
	)}${input.def.pageImportExtension ?? ''}`;

	return {
		cssAssetKey: input.cssAssetKey,
		indexKey: input.indexKey,
		manifestKey: input.manifestKey,
		pageSpecifier: specifier,
		pascal: input.pascal,
		route: input.route,
		title: input.title
	} satisfies RouteContext;
};

export const wirePluginUse = (
	serverEntry: string,
	pluginName: string,
	moduleSpecifier: string
) => {
	const specs: ImportSpec[] = [
		{ kind: 'named', module: moduleSpecifier, name: pluginName }
	];
	const fallback = {
		kind: 'manual',
		reason: 'could not find an Elysia chain in the server entry',
		snippet: `import { ${pluginName} } from '${moduleSpecifier}';\n\n.use(${pluginName})`
	} satisfies WireResult;
	if (!hasChain(serverEntry)) return fallback;

	const text = readFileSync(serverEntry, 'utf-8');
	const sourceFile = parse(serverEntry, text);
	const newExpr = findElysiaNew(sourceFile);
	if (!newExpr) return fallback;

	const top = climbChain(newExpr);
	const { offset, separator } = findRouteInsertion(text, top);
	const edits = buildImportEdits(sourceFile, specs);
	edits.push({
		end: offset,
		start: offset,
		text: `${separator}.use(${pluginName})`
	});
	writeFileSync(serverEntry, applyEdits(text, edits), 'utf-8');

	return { kind: 'edited', routingFile: serverEntry } satisfies WireResult;
};
export const wireRoute = (input: WireInput) => {
	const routingFile = findRoutingFile(input.serverEntry);
	const ctx = routingFile
		? buildRouteContext(input, routingFile)
		: buildRouteContext(input, input.serverEntry);
	const specs = input.def.routeImports(ctx);
	const routeExpr = input.def.routeExpression(ctx);

	if (!routingFile) {
		return {
			kind: 'manual',
			reason: 'could not find an Elysia route chain',
			snippet: `${renderImportBlock(specs)}\n\n${routeExpr}`
		} satisfies WireResult;
	}

	const text = readFileSync(routingFile, 'utf-8');
	const sourceFile = parse(routingFile, text);
	const newExpr = findElysiaNew(sourceFile);
	if (!newExpr) {
		return {
			kind: 'manual',
			reason: 'could not find an Elysia route chain',
			snippet: `${renderImportBlock(specs)}\n\n${routeExpr}`
		} satisfies WireResult;
	}

	const top = climbChain(newExpr);
	const { offset, separator } = findRouteInsertion(text, top);
	const edits = buildImportEdits(sourceFile, specs);
	edits.push({
		end: offset,
		start: offset,
		text: `${separator}${routeExpr}`
	});
	writeFileSync(routingFile, applyEdits(text, edits), 'utf-8');

	return { kind: 'edited', routingFile } satisfies WireResult;
};
