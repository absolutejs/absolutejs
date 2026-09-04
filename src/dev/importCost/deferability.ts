/* Static safety check: can a top-level import of the entry actually be moved
 * inside a function?
 *
 * A predicted saving is worthless if the import cannot be deferred, so every
 * candidate gets a verdict from the TypeScript compiler API — not a regex —
 * over the entry's own source:
 *
 * - a bare `import "x"` is never deferrable. It is loaded for its side effect
 *   and the side effect is usually order-sensitive (`reflect-metadata` has to
 *   be first, or tsyringe-based dependencies throw).
 * - an import whose bindings are only ever referenced inside function or
 *   method bodies is deferrable.
 * - anything referenced at module scope, in a decorator, in a class-field
 *   initializer, or re-exported from the entry is not.
 *
 * The classifier is deliberately one-sided. Where it cannot prove a reference
 * is deferred it says "used at module scope", so it can under-report a
 * deferrable import but never claim one that is not. */

import ts from 'typescript';

export type EntryImport = {
	line: number;
	/** Why it is not deferrable, when it is not. */
	reason: string | null;
	specifier: string;
	verdict: EntryImportVerdict;
};

export type EntryImportVerdict =
	| 'deferrable'
	| 'side-effect import'
	| 'type-only'
	| 'used at module scope';

type EntryDeclaration = {
	bindings: string[];
	line: number;
	sideEffect: boolean;
	specifier: string;
	typeOnly: boolean;
};

/** Sentinel meaning "this reference runs later, not at module evaluation". */
const DEFERRED = 'deferred';

const scriptKindFor = (fileName: string) => {
	if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
	if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
	if (fileName.endsWith('.js') || fileName.endsWith('.mjs')) {
		return ts.ScriptKind.JS;
	}

	return ts.ScriptKind.TS;
};

const namedBindings = (clause: ts.ImportClause) => {
	const names = clause.name === undefined ? [] : [clause.name.text];
	const { namedBindings: bindings } = clause;
	if (bindings === undefined) return names;
	if (ts.isNamespaceImport(bindings)) return [...names, bindings.name.text];

	return [
		...names,
		...bindings.elements
			.filter((element) => !element.isTypeOnly)
			.map((element) => element.name.text)
	];
};

const declarationFrom = (
	statement: ts.ImportDeclaration,
	source: ts.SourceFile
) => {
	const specifier = statement.moduleSpecifier;
	if (!ts.isStringLiteral(specifier)) return null;
	const clause = statement.importClause;
	const bindings = clause === undefined ? [] : namedBindings(clause);
	const declaration: EntryDeclaration = {
		bindings,
		line:
			ts.getLineAndCharacterOfPosition(source, statement.getStart(source))
				.line + 1,
		sideEffect: clause === undefined,
		specifier: specifier.text,
		typeOnly:
			clause !== undefined && (clause.isTypeOnly || bindings.length === 0)
	};

	return declaration;
};

const isTypePosition = (node: ts.Node) =>
	ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node);

const isDeferredPosition = (current: ts.Node, child: ts.Node) => {
	if (Reflect.get(current, 'body') === child) return true;
	const parameters = Reflect.get(current, 'parameters');

	return (
		Array.isArray(parameters) &&
		parameters.some((parameter) => parameter === child)
	);
};

/** `null` means "keep climbing"; `DEFERRED` means safe; anything else is the
 *  reason the import has to stay at the top. */
const classifyAncestor = (current: ts.Node, child: ts.Node) => {
	if (ts.isExportSpecifier(current)) return 're-exported by the entry';
	if (ts.isDecorator(current)) return 'decorator';
	if (ts.isPropertyDeclaration(current) && current.initializer === child) {
		return 'class field initializer';
	}
	if (isTypePosition(current)) return DEFERRED;
	if (ts.isFunctionLike(current) && isDeferredPosition(current, child)) {
		return DEFERRED;
	}
	if (ts.isSourceFile(current)) return 'module scope';

	return null;
};

/* Climb to the first ancestor that settles it. A reason found on the way up
   is remembered rather than returned, because a decorator or a field
   initializer inside a function only runs when that function runs: reaching a
   function *body* clears it. Reaching the source file does not. */
const classifyUsage = (node: ts.Identifier) => {
	let child: ts.Node = node;
	let current: ts.Node | undefined = node.parent;
	let pending: string | null = null;
	while (current !== undefined) {
		const verdict = classifyAncestor(current, child);
		if (verdict === DEFERRED) return DEFERRED;
		if (verdict !== null && pending === null) pending = verdict;
		child = current;
		current = current.parent;
	}

	return pending ?? 'module scope';
};

const isDeclarationName = (parent: ts.Node, node: ts.Identifier) => {
	if (ts.isExportSpecifier(parent)) return false;
	if (ts.isShorthandPropertyAssignment(parent)) return false;

	return Reflect.get(parent, 'name') === node;
};

const isReferencePosition = (node: ts.Identifier) => {
	const { parent } = node;
	if (parent === undefined) return false;
	if (ts.isQualifiedName(parent) && parent.right === node) return false;

	return !isDeclarationName(parent, node);
};

const recordUsage = (
	node: ts.Identifier,
	owners: ReadonlyMap<string, number>,
	reasons: Map<number, string>
) => {
	const owner = owners.get(node.text);
	if (owner === undefined || reasons.has(owner)) return;
	if (!isReferencePosition(node)) return;
	const verdict = classifyUsage(node);
	if (verdict !== DEFERRED) reasons.set(owner, verdict);
};

const collectUnsafeReasons = (
	source: ts.SourceFile,
	owners: ReadonlyMap<string, number>
) => {
	const reasons = new Map<number, string>();
	const visit = (node: ts.Node) => {
		if (ts.isImportDeclaration(node)) return;
		if (ts.isIdentifier(node)) recordUsage(node, owners, reasons);
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(source, visit);

	return reasons;
};

const verdictFor = (
	declaration: EntryDeclaration,
	reason: string | undefined
) => {
	if (declaration.sideEffect) return 'side-effect import';
	if (declaration.typeOnly) return 'type-only';
	if (reason !== undefined) return 'used at module scope';

	return 'deferrable';
};

const reExportOf = (statement: ts.ExportDeclaration, source: ts.SourceFile) => {
	const specifier = statement.moduleSpecifier;
	if (specifier === undefined || !ts.isStringLiteral(specifier)) return null;
	if (statement.isTypeOnly) return null;
	const entry: EntryImport = {
		line:
			ts.getLineAndCharacterOfPosition(source, statement.getStart(source))
				.line + 1,
		reason: 're-exported by the entry',
		specifier: specifier.text,
		verdict: 'used at module scope'
	};

	return entry;
};

/** One verdict per top-level import (and re-export) of the entry, in source
 *  order. Pure: give it the entry's text, get the verdicts back. */
export const analyzeEntryImports = (sourceText: string, fileName: string) => {
	const source = ts.createSourceFile(
		fileName,
		sourceText,
		ts.ScriptTarget.ESNext,
		true,
		scriptKindFor(fileName)
	);
	const declarations = source.statements
		.filter(ts.isImportDeclaration)
		.map((statement) => declarationFrom(statement, source))
		.filter((declaration) => declaration !== null);
	const reExports = source.statements
		.filter(ts.isExportDeclaration)
		.map((statement) => reExportOf(statement, source))
		.filter((entry) => entry !== null);
	const owners = new Map<string, number>();
	declarations.forEach((declaration, index) => {
		for (const binding of declaration.bindings) owners.set(binding, index);
	});
	const reasons = collectUnsafeReasons(source, owners);
	const imports = declarations.map((declaration, index) => {
		const reason = reasons.get(index);
		const verdict = verdictFor(declaration, reason);
		const entry: EntryImport = {
			line: declaration.line,
			reason: verdict === 'deferrable' ? null : (reason ?? null),
			specifier: declaration.specifier,
			verdict
		};

		return entry;
	});

	return [...imports, ...reExports].sort(
		(left, right) => left.line - right.line
	);
};
