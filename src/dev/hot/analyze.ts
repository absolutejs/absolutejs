import { dirname, extname } from 'node:path';
import type * as TS from 'typescript';

/* Static analysis and rewrite of one server module for backend HMR (see
 * docs/BACKEND_HMR.md).
 *
 * Each top-level statement gets a stable id, a hash of its text, the
 * top-level declarations it references and the imports it uses while the
 * module evaluates (the plan). The rewritten module routes each statement
 * through the hot runtime (`__absH`), which skips a statement — returning its
 * previous value — unless it, an import it used, or a declaration it
 * references changed. Top-level `let`/`var` move
 * into a per-module store (`__absC`) that survives versions.
 *
 * Every rewrite is an insertion or a same-line replacement, so line numbers
 * in stack traces still match the source file. */

export const ANALYZER_VERSION = 1;

export type ExportKind = 'class' | 'function' | 'live' | 'value';

export type ImportUse = {
	/** Resolved module path the binding comes from. */
	module: string;
	/** Imported name: an export name, `default`, or `*` for a namespace. */
	name: string;
	/** The binding is called (or constructed) rather than only read. */
	call: boolean;
};

/** One top-level statement as the runtime sees it. A statement re-runs in a
 *  new version when its text or an import it uses while evaluating changed,
 *  or when a declaration it references (`deps`, indices into the plan)
 *  re-runs. Cells (top-level `let`/`var`) only re-initialise when their own
 *  declaration changes. */
export type StatementPlan = {
	/** Runtime ids the statement uses (one per declarator for `const`). */
	ids: string[];
	hash: string;
	deps: number[];
	/** Imports used while the module evaluates: [module, name, call]. */
	imports: Array<[string, string, 0 | 1]>;
	cell: boolean;
	/** Untransformed: re-evaluated by every version. */
	always: boolean;
};

export type HotModuleAnalysis = {
	ok: true;
	/** Rewritten module source (the implementation). */
	code: string;
	/** Export name → kind, and the plan entry that declares it (-1 for a
	 *  re-exported import, which the facade forwards live). */
	exports: Record<string, { kind: ExportKind; plan: number }>;
	/** `export … from` statements, copied into the facade verbatim. */
	reexports: string[];
	plan: StatementPlan[];
};

export type HotModuleRejection = { ok: false; reason: string };

type Ts = typeof TS;
type Edit = { pos: number; del: number; text: string; order: number };
type ImportBinding = { module: string | undefined; name: string };
type Reference = {
	name: string;
	deferred: boolean;
	call: boolean;
	member?: string;
	node: TS.Identifier;
	shorthand: boolean;
};
type StatementKind =
	| 'class'
	| 'const'
	| 'default'
	| 'export-list'
	| 'function'
	| 'import'
	| 'let'
	| 'reexport'
	| 'run'
	| 'skip'
	| 'untouched';
type TopStatement = {
	node: TS.Statement;
	kind: StatementKind;
	id: string;
	declares: string[];
	refs: Reference[];
	ownHash: string;
};
type Counters = { ordinal: number; run: number };
type ClassifyContext = {
	counters: Counters;
	exportedLocalNames: Set<string>;
	reexports: string[];
};
type ModuleScope = {
	imports: Map<string, ImportBinding>;
	topLevel: Set<string>;
	exportedLocals: Map<string, string>;
};

const hashText = (text: string) => Bun.hash(text).toString(36);

const scriptKindFor = (tsc: Ts, path: string) => {
	switch (extname(path)) {
		case '.tsx':
			return tsc.ScriptKind.TSX;
		case '.jsx':
			return tsc.ScriptKind.JSX;
		case '.js':
		case '.mjs':
		case '.cjs':
			return tsc.ScriptKind.JS;
		default:
			return tsc.ScriptKind.TS;
	}
};

const hasModifier = (tsc: Ts, node: TS.Node, kind: TS.SyntaxKind) =>
	tsc.canHaveModifiers(node) &&
	(tsc.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);

const bindingNames = (tsc: Ts, name: TS.BindingName): string[] => {
	if (tsc.isIdentifier(name)) return [name.text];
	const names: string[] = [];
	for (const element of name.elements) {
		if (tsc.isOmittedExpression(element)) continue;
		names.push(...bindingNames(tsc, element.name));
	}

	return names;
};

const declarationListNames = (tsc: Ts, list: TS.VariableDeclarationList) =>
	list.declarations.flatMap((declaration) =>
		bindingNames(tsc, declaration.name)
	);

const isFunctionLike = (
	tsc: Ts,
	node: TS.Node
): node is TS.FunctionLikeDeclaration =>
	tsc.isFunctionDeclaration(node) ||
	tsc.isFunctionExpression(node) ||
	tsc.isArrowFunction(node) ||
	tsc.isMethodDeclaration(node) ||
	tsc.isConstructorDeclaration(node) ||
	tsc.isGetAccessorDeclaration(node) ||
	tsc.isSetAccessorDeclaration(node);

const isVarList = (tsc: Ts, node: TS.Node) =>
	tsc.isVariableDeclarationList(node) &&
	!(node.flags & (tsc.NodeFlags.Let | tsc.NodeFlags.Const));

/** Names one statement declares in its block's scope. */
const statementDeclarations = (tsc: Ts, statement: TS.Statement) => {
	if (tsc.isVariableStatement(statement))
		return declarationListNames(tsc, statement.declarationList);
	if (
		(tsc.isFunctionDeclaration(statement) ||
			tsc.isClassDeclaration(statement) ||
			tsc.isEnumDeclaration(statement)) &&
		statement.name
	)
		return [statement.name.text];

	return [];
};

/** Names a block-level statement list declares in that block's scope. */
const blockDeclarations = (tsc: Ts, statements: readonly TS.Statement[]) =>
	new Set(
		statements.flatMap((statement) => statementDeclarations(tsc, statement))
	);

/** `var` declarations anywhere in a function body (not nested functions)
 *  hoist to the function's scope. */
const hoistedVars = (tsc: Ts, body: TS.Node) => {
	const names = new Set<string>();
	const visit = (node: TS.Node) => {
		if (node !== body && isFunctionLike(tsc, node)) return;
		if (tsc.isVariableDeclarationList(node) && isVarList(tsc, node))
			for (const name of declarationListNames(tsc, node)) names.add(name);
		tsc.forEachChild(node, visit);
	};
	visit(body);

	return names;
};

/** True when `node` contains an `await` (or `for await`) that runs when the
 *  module evaluates — not inside a nested function. */
const hasTopLevelAwait = (tsc: Ts, node: TS.Node) => {
	let found = false;
	const visit = (child: TS.Node) => {
		if (found || isFunctionLike(tsc, child)) return;
		if (
			tsc.isAwaitExpression(child) ||
			(tsc.isForOfStatement(child) && child.awaitModifier)
		) {
			found = true;

			return;
		}
		tsc.forEachChild(child, visit);
	};
	visit(node);

	return found;
};

/** A `var` inside a top-level block belongs to the module scope; wrapping
 *  the statement in a function would move it. */
const declaresModuleVar = (tsc: Ts, statement: TS.Statement) => {
	let found = false;
	const visit = (node: TS.Node) => {
		if (found || isFunctionLike(tsc, node) || tsc.isClassLike(node)) return;
		if (isVarList(tsc, node)) {
			found = true;

			return;
		}
		tsc.forEachChild(node, visit);
	};
	tsc.forEachChild(statement, visit);

	return found;
};

/** Whether an identifier sits where it reads a binding (rather than naming
 *  a property, a declaration, a label or an intrinsic JSX tag). */
const isReferencePosition = (tsc: Ts, node: TS.Identifier) => {
	const { parent } = node;
	if (!parent) return true;
	if (tsc.isPropertyAccessExpression(parent) && parent.name === node)
		return false;
	if (tsc.isQualifiedName(parent)) return false;
	if (
		(tsc.isPropertyAssignment(parent) ||
			tsc.isPropertyDeclaration(parent) ||
			tsc.isMethodDeclaration(parent) ||
			tsc.isGetAccessorDeclaration(parent) ||
			tsc.isSetAccessorDeclaration(parent) ||
			tsc.isPropertySignature(parent) ||
			tsc.isMethodSignature(parent) ||
			tsc.isEnumMember(parent)) &&
		parent.name === node
	)
		return false;
	if (tsc.isBindingElement(parent) && parent.propertyName === node)
		return false;
	if (
		(tsc.isVariableDeclaration(parent) ||
			tsc.isParameter(parent) ||
			tsc.isBindingElement(parent) ||
			tsc.isFunctionDeclaration(parent) ||
			tsc.isFunctionExpression(parent) ||
			tsc.isClassDeclaration(parent) ||
			tsc.isClassExpression(parent) ||
			tsc.isEnumDeclaration(parent) ||
			tsc.isModuleDeclaration(parent) ||
			tsc.isTypeAliasDeclaration(parent) ||
			tsc.isInterfaceDeclaration(parent)) &&
		parent.name === node
	)
		return false;
	if (
		tsc.isImportSpecifier(parent) ||
		tsc.isImportClause(parent) ||
		tsc.isNamespaceImport(parent) ||
		tsc.isExportSpecifier(parent)
	)
		return false;
	if (
		tsc.isLabeledStatement(parent) ||
		tsc.isBreakStatement(parent) ||
		tsc.isContinueStatement(parent)
	)
		return false;
	if (tsc.isJsxAttribute(parent) && parent.name === node) return false;
	if (
		(tsc.isJsxOpeningElement(parent) ||
			tsc.isJsxSelfClosingElement(parent) ||
			tsc.isJsxClosingElement(parent)) &&
		parent.tagName === node
	)
		return /^[A-Z]/.test(node.text);
	if (tsc.isMetaProperty(parent)) return false;

	return true;
};

const isCallee = (tsc: Ts, parent: TS.Node, node: TS.Node) =>
	(tsc.isCallExpression(parent) || tsc.isNewExpression(parent)) &&
	parent.expression === node;

/** Names a function introduces in its own scope: its name (for a named
 *  function expression or nested declaration), its parameters, its hoisted
 *  `var`s and its body's block-level declarations. */
const functionScopeNames = (
	tsc: Ts,
	declaration: TS.FunctionLikeDeclaration,
	isRoot: boolean
) => {
	const names = new Set<string>();
	if (
		(tsc.isFunctionExpression(declaration) ||
			tsc.isFunctionDeclaration(declaration)) &&
		declaration.name &&
		!isRoot
	)
		names.add(declaration.name.text);
	for (const parameter of declaration.parameters)
		for (const name of bindingNames(tsc, parameter.name)) names.add(name);
	if (!declaration.body) return names;
	for (const name of hoistedVars(tsc, declaration.body)) names.add(name);
	if (tsc.isBlock(declaration.body))
		for (const name of blockDeclarations(tsc, declaration.body.statements))
			names.add(name);

	return names;
};

const loopScopeNames = (tsc: Ts, init: TS.ForInitializer | undefined) =>
	init && tsc.isVariableDeclarationList(init)
		? new Set(declarationListNames(tsc, init))
		: new Set<string>();

/** Every reference from `root` to a module-scope name, with whether it runs
 *  while the module evaluates (`deferred: false`) or later from a function
 *  body, and whether it is a call. Names shadowed by an inner scope are not
 *  module references. */
const collectReferences = (tsc: Ts, root: TS.Node, topLevel: Set<string>) => {
	const references: Reference[] = [];
	const scopes: Set<string>[] = [];
	const shadowed = (name: string) => scopes.some((scope) => scope.has(name));

	const record = (node: TS.Identifier, deferred: boolean) => {
		const name = node.text;
		if (!topLevel.has(name) || shadowed(name)) return;
		const { parent } = node;
		let call = false;
		let member: string | undefined;
		if (isCallee(tsc, parent, node)) call = true;
		if (tsc.isTaggedTemplateExpression(parent) && parent.tag === node)
			call = true;
		if (
			tsc.isPropertyAccessExpression(parent) &&
			parent.expression === node
		) {
			member = parent.name.text;
			const grand = parent.parent;
			if (grand && isCallee(tsc, grand, parent)) call = true;
		}
		references.push({
			call,
			deferred,
			member,
			name,
			node,
			shorthand: tsc.isShorthandPropertyAssignment(parent)
		});
	};

	const withScope = (names: Set<string>, work: () => void) => {
		scopes.push(names);
		try {
			work();
		} finally {
			scopes.pop();
		}
	};

	const visitChildren = (node: TS.Node, deferred: boolean) =>
		tsc.forEachChild(node, (child) => visit(child, deferred));

	const visitFunction = (
		declaration: TS.FunctionLikeDeclaration,
		deferred: boolean
	) => {
		const names = functionScopeNames(
			tsc,
			declaration,
			declaration === root
		);
		// Decorators and computed names evaluate with the enclosing code.
		if (tsc.canHaveDecorators(declaration))
			for (const decorator of tsc.getDecorators(declaration) ?? [])
				visit(decorator, deferred);
		if (declaration.name && tsc.isComputedPropertyName(declaration.name))
			visit(declaration.name, deferred);
		withScope(names, () => {
			for (const parameter of declaration.parameters) {
				if (parameter.initializer) visit(parameter.initializer, true);
				if (!tsc.isIdentifier(parameter.name))
					visit(parameter.name, true);
			}
			if (declaration.body) visit(declaration.body, true);
		});
	};

	const visitClassMember = (member: TS.ClassElement, deferred: boolean) => {
		if (member.name && tsc.isComputedPropertyName(member.name))
			visit(member.name, deferred);
		if (tsc.isPropertyDeclaration(member)) {
			const isStatic = hasModifier(
				tsc,
				member,
				tsc.SyntaxKind.StaticKeyword
			);
			if (member.initializer)
				visit(member.initializer, isStatic ? deferred : true);

			return;
		}
		if (tsc.isClassStaticBlockDeclaration(member)) {
			visit(member.body, deferred);

			return;
		}
		visit(member, deferred);
	};

	const visitClass = (node: TS.ClassLikeDeclaration, deferred: boolean) => {
		const names = new Set<string>();
		if (node.name && node !== root) names.add(node.name.text);
		withScope(names, () => {
			if (tsc.canHaveDecorators(node))
				for (const decorator of tsc.getDecorators(node) ?? [])
					visit(decorator, deferred);
			for (const clause of node.heritageClauses ?? [])
				visit(clause, deferred);
			for (const member of node.members)
				visitClassMember(member, deferred);
		});
	};

	const visitBlock = (
		node: TS.Block | TS.ModuleBlock | TS.CaseBlock,
		deferred: boolean
	) => {
		const statements = tsc.isCaseBlock(node)
			? node.clauses.flatMap((clause) => [...clause.statements])
			: node.statements;
		withScope(blockDeclarations(tsc, statements), () =>
			visitChildren(node, deferred)
		);
	};

	const visitCatch = (node: TS.CatchClause, deferred: boolean) => {
		const names = node.variableDeclaration
			? new Set(bindingNames(tsc, node.variableDeclaration.name))
			: new Set<string>();
		withScope(names, () => visit(node.block, deferred));
	};

	const visitBindingElement = (
		node: TS.BindingElement,
		deferred: boolean
	) => {
		if (node.propertyName && tsc.isComputedPropertyName(node.propertyName))
			visit(node.propertyName, deferred);
		if (!tsc.isIdentifier(node.name)) visit(node.name, deferred);
		if (node.initializer) visit(node.initializer, deferred);
	};

	const visitHeritage = (node: TS.HeritageClause, deferred: boolean) => {
		if (node.token === tsc.SyntaxKind.ImplementsKeyword) return;
		for (const type of node.types) visit(type.expression, deferred);
	};

	const isTypeOnlyNode = (node: TS.Node) =>
		(tsc.isTypeNode(node) && !tsc.isExpressionWithTypeArguments(node)) ||
		tsc.isInterfaceDeclaration(node) ||
		tsc.isTypeAliasDeclaration(node) ||
		tsc.isTypeParameterDeclaration(node);

	const isTypeWrapper = (
		node: TS.Node
	): node is
		| TS.AsExpression
		| TS.SatisfiesExpression
		| TS.TypeAssertion
		| TS.NonNullExpression =>
		tsc.isAsExpression(node) ||
		tsc.isSatisfiesExpression(node) ||
		tsc.isTypeAssertionExpression(node) ||
		tsc.isNonNullExpression(node);

	const visit = (node: TS.Node, deferred: boolean): void => {
		if (isTypeOnlyNode(node)) return undefined;
		if (tsc.isHeritageClause(node)) return visitHeritage(node, deferred);
		if (isTypeWrapper(node)) return visit(node.expression, deferred);
		if (tsc.isIdentifier(node)) {
			if (isReferencePosition(tsc, node)) record(node, deferred);

			return undefined;
		}
		if (isFunctionLike(tsc, node)) return visitFunction(node, deferred);
		if (tsc.isClassLike(node)) return visitClass(node, deferred);
		if (
			tsc.isBlock(node) ||
			tsc.isModuleBlock(node) ||
			tsc.isCaseBlock(node)
		)
			return visitBlock(node, deferred);
		if (
			tsc.isForStatement(node) ||
			tsc.isForInStatement(node) ||
			tsc.isForOfStatement(node)
		)
			return withScope(loopScopeNames(tsc, node.initializer), () =>
				visitChildren(node, deferred)
			);
		if (tsc.isCatchClause(node)) return visitCatch(node, deferred);
		if (tsc.isVariableDeclaration(node)) {
			if (!tsc.isIdentifier(node.name)) visit(node.name, deferred);
			if (node.initializer) visit(node.initializer, deferred);

			return undefined;
		}
		if (tsc.isBindingElement(node))
			return visitBindingElement(node, deferred);
		visitChildren(node, deferred);

		return undefined;
	};

	visit(root, false);

	return references;
};

const isFunctionInitializer = (tsc: Ts, node: TS.Expression | undefined) => {
	let current = node;
	while (
		current &&
		(tsc.isParenthesizedExpression(current) ||
			tsc.isAsExpression(current) ||
			tsc.isSatisfiesExpression(current))
	)
		current = current.expression;

	return (
		current !== undefined &&
		(tsc.isArrowFunction(current) || tsc.isFunctionExpression(current))
	);
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export type ResolveImport = (specifier: string) => string | undefined;

const rejection = (reason: string): HotModuleRejection => ({
	ok: false,
	reason
});

const addImport = (
	scope: ModuleScope,
	local: string,
	binding: ImportBinding
) => {
	scope.imports.set(local, binding);
	scope.topLevel.add(local);
};

const recordImport = (
	tsc: Ts,
	scope: ModuleScope,
	statement: TS.ImportDeclaration,
	resolveImport: ResolveImport
) => {
	const clause = statement.importClause;
	if (!clause || clause.isTypeOnly) return;
	const specifier = statement.moduleSpecifier;
	const module =
		tsc.isStringLiteralLike(specifier) || tsc.isIdentifier(specifier)
			? resolveImport(specifier.text)
			: undefined;
	if (clause.name)
		addImport(scope, clause.name.text, { module, name: 'default' });
	const bindings = clause.namedBindings;
	if (!bindings) return;
	if (tsc.isNamespaceImport(bindings)) {
		addImport(scope, bindings.name.text, { module, name: '*' });

		return;
	}
	for (const element of bindings.elements) {
		if (element.isTypeOnly) continue;
		addImport(scope, element.name.text, {
			module,
			name: (element.propertyName ?? element.name).text
		});
	}
};

/** Records a local `export { … }` list; returns a rejection reason for an
 *  export name the facade cannot declare. */
const recordExportList = (
	tsc: Ts,
	scope: ModuleScope,
	statement: TS.Statement
) => {
	if (
		!tsc.isExportDeclaration(statement) ||
		statement.moduleSpecifier ||
		statement.isTypeOnly ||
		!statement.exportClause ||
		!tsc.isNamedExports(statement.exportClause)
	)
		return undefined;
	for (const element of statement.exportClause.elements) {
		if (element.isTypeOnly) continue;
		const exported = element.name.text;
		if (!IDENTIFIER.test(exported) && exported !== 'default')
			return 'string export name';
		scope.exportedLocals.set(
			exported,
			(element.propertyName ?? element.name).text
		);
	}

	return undefined;
};

/** Pass 1 for one statement: what it declares and imports. Returns a
 *  rejection reason when the module cannot be hot-managed. */
const declareStatement = (
	tsc: Ts,
	scope: ModuleScope,
	statement: TS.Statement,
	resolveImport: ResolveImport
) => {
	if (tsc.isImportDeclaration(statement)) {
		recordImport(tsc, scope, statement, resolveImport);

		return undefined;
	}
	if (tsc.isImportEqualsDeclaration(statement)) return 'import = require';
	const isDeclared = hasModifier(
		tsc,
		statement,
		tsc.SyntaxKind.DeclareKeyword
	);
	if (tsc.isVariableStatement(statement)) {
		if (!isDeclared)
			for (const name of declarationListNames(
				tsc,
				statement.declarationList
			))
				scope.topLevel.add(name);

		return undefined;
	}
	if (
		(tsc.isFunctionDeclaration(statement) ||
			tsc.isClassDeclaration(statement) ||
			tsc.isEnumDeclaration(statement)) &&
		statement.name &&
		!isDeclared
	)
		scope.topLevel.add(statement.name.text);
	if (
		tsc.isModuleDeclaration(statement) &&
		tsc.isIdentifier(statement.name) &&
		!isDeclared
	)
		scope.topLevel.add(statement.name.text);

	return recordExportList(tsc, scope, statement);
};

const classification = (
	kind: StatementKind,
	id: string,
	declares: string[] = []
) => ({ declares, id, kind });

const classifyExportDeclaration = (
	statement: TS.ExportDeclaration,
	text: string,
	context: ClassifyContext
) => {
	const { counters } = context;
	if (statement.isTypeOnly)
		return classification('skip', `t:${counters.ordinal++}`);
	if (statement.moduleSpecifier) {
		context.reexports.push(text);

		return classification('reexport', `x:${counters.ordinal++}`);
	}

	return classification('export-list', `e:${counters.ordinal++}`);
};

const classifyFunction = (
	statement: TS.FunctionDeclaration,
	counters: Counters
) => {
	if (!statement.body)
		return classification('skip', `t:${counters.ordinal++}`);
	const name = statement.name?.text ?? 'default';

	return classification('function', `f:${name}`, [name]);
};

const classifyClass = (tsc: Ts, statement: TS.ClassDeclaration) => {
	const decorated = (tsc.getDecorators(statement) ?? []).length > 0;
	const isAbstract = hasModifier(
		tsc,
		statement,
		tsc.SyntaxKind.AbstractKeyword
	);
	const name = statement.name?.text ?? 'default';

	return classification(
		decorated || isAbstract ? 'untouched' : 'class',
		`c:${name}`,
		[name]
	);
};

const classifyVariable = (
	tsc: Ts,
	statement: TS.VariableStatement,
	context: ClassifyContext
) => {
	const list = statement.declarationList;
	const names = declarationListNames(tsc, list);
	const isConst = (list.flags & tsc.NodeFlags.Const) !== 0;
	const exported = hasModifier(tsc, statement, tsc.SyntaxKind.ExportKeyword);
	const id = `v:${names[0] ?? context.counters.ordinal++}`;
	if (isConst) return classification('const', id, names);
	const simple = list.declarations.every((declaration) =>
		tsc.isIdentifier(declaration.name)
	);
	const isExported =
		exported || names.some((name) => context.exportedLocalNames.has(name));

	return classification(
		simple && !isExported ? 'let' : 'untouched',
		id,
		names
	);
};

const isSkippedStatement = (tsc: Ts, statement: TS.Statement) =>
	tsc.isInterfaceDeclaration(statement) ||
	tsc.isTypeAliasDeclaration(statement) ||
	tsc.isEmptyStatement(statement) ||
	hasModifier(tsc, statement, tsc.SyntaxKind.DeclareKeyword);

const isLeadingDirective = (
	tsc: Ts,
	file: TS.SourceFile,
	statement: TS.Statement
) =>
	tsc.isExpressionStatement(statement) &&
	tsc.isStringLiteral(statement.expression) &&
	statement.getStart(file) === file.statements[0]?.getStart(file);

/** Pass 2 for one statement: its kind, runtime id and the names it
 *  declares. `undefined` rejects the module (`export =`). */
const classifyStatement = (
	tsc: Ts,
	file: TS.SourceFile,
	statement: TS.Statement,
	text: string,
	context: ClassifyContext
) => {
	const { counters } = context;
	if (tsc.isImportDeclaration(statement))
		return classification('import', `i:${counters.ordinal++}`);
	if (isSkippedStatement(tsc, statement))
		return classification('skip', `t:${counters.ordinal++}`);
	if (tsc.isExportDeclaration(statement))
		return classifyExportDeclaration(statement, text, context);
	if (tsc.isExportAssignment(statement))
		return statement.isExportEquals
			? undefined
			: classification('default', 'd:default', []);
	if (tsc.isFunctionDeclaration(statement))
		return classifyFunction(statement, counters);
	if (tsc.isClassDeclaration(statement)) return classifyClass(tsc, statement);
	if (tsc.isVariableStatement(statement))
		return classifyVariable(tsc, statement, context);
	if (
		tsc.isEnumDeclaration(statement) ||
		tsc.isModuleDeclaration(statement)
	) {
		const name = tsc.isIdentifier(statement.name)
			? statement.name.text
			: `${counters.ordinal++}`;

		return classification('untouched', `n:${name}`, [name]);
	}
	if (isLeadingDirective(tsc, file, statement))
		return classification('skip', `t:${counters.ordinal++}`);

	return classification(
		declaresModuleVar(tsc, statement) ? 'untouched' : 'run',
		`s:${counters.run++}`
	);
};

const compareEdits = (left: Edit, right: Edit) => {
	if (right.pos !== left.pos) return right.pos - left.pos;
	if (right.del !== left.del) return right.del - left.del;

	return right.order - left.order;
};

/** Analyse and rewrite a module. `canonicalPath` is the module's identity in
 *  the hot runtime (the real entry path for the entry's snapshot copies). */
export const analyzeModule = (
	tsc: Ts,
	canonicalPath: string,
	source: string,
	resolveImport: ResolveImport
) => {
	if (source.startsWith('#!')) return rejection('shebang');
	const file = tsc.createSourceFile(
		canonicalPath,
		source,
		tsc.ScriptTarget.Latest,
		true,
		scriptKindFor(tsc, canonicalPath)
	);
	const scope: ModuleScope = {
		exportedLocals: new Map<string, string>(),
		imports: new Map<string, ImportBinding>(),
		topLevel: new Set<string>()
	};
	const { exportedLocals, imports, topLevel } = scope;
	const statements: TopStatement[] = [];
	const reexports: string[] = [];

	// Pass 1: what the module declares and imports.
	for (const statement of file.statements) {
		const reason = declareStatement(tsc, scope, statement, resolveImport);
		if (reason) return rejection(reason);
	}

	// Pass 2: classify each statement.
	const context: ClassifyContext = {
		counters: { ordinal: 0, run: 0 },
		exportedLocalNames: new Set(exportedLocals.values()),
		reexports
	};
	for (const statement of file.statements) {
		const text = statement.getText(file);
		const classified = classifyStatement(
			tsc,
			file,
			statement,
			text,
			context
		);
		if (!classified) return rejection('export =');
		const { declares, id, kind } = classified;
		statements.push({
			declares,
			id,
			kind,
			node: statement,
			ownHash: hashText(`${kind}\u0000${text}`),
			refs:
				kind === 'import' || kind === 'skip'
					? []
					: collectReferences(tsc, statement, topLevel)
		});
	}

	const declaredBy = new Map<string, TopStatement>();
	for (const statement of statements)
		for (const name of statement.declares) declaredBy.set(name, statement);

	const recordUse = (
		uses: Map<string, ImportUse>,
		imported: ImportBinding,
		reference: Reference
	) => {
		if (!imported.module) return;
		const name =
			imported.name === '*' && reference.member
				? reference.member
				: imported.name;
		const key = `${imported.module}\u0000${name}`;
		const existing = uses.get(key);
		uses.set(key, {
			call: reference.call || (existing?.call ?? false),
			module: imported.module,
			name
		});
	};

	// Imports a statement uses while the module evaluates: its own, plus
	// everything reachable through local functions it calls (their bodies
	// run now too) and local declarations it reads.
	const evalImports = (start: TopStatement) => {
		const uses = new Map<string, ImportUse>();
		const seen = new Set<TopStatement>();
		const walk = (statement: TopStatement, includeDeferred: boolean) => {
			if (seen.has(statement)) return;
			seen.add(statement);
			for (const reference of statement.refs) {
				if (reference.deferred && !includeDeferred) continue;
				const imported = imports.get(reference.name);
				if (imported) recordUse(uses, imported, reference);
				const target = imported
					? undefined
					: declaredBy.get(reference.name);
				if (!target || target === statement) continue;
				// A called local function runs its whole body now; a function that
				// is only referenced runs later, through late-bound imports.
				walk(target, reference.call);
			}
		};
		walk(start, false);

		return [...uses.values()];
	};

	// The kind each exported local has.
	const kindOfLocal = (name: string) => {
		const statement = declaredBy.get(name);
		if (!statement) return 'value';
		if (statement.kind === 'function') return 'function';
		if (statement.kind === 'class') return 'class';
		if (
			statement.kind === 'untouched' &&
			tsc.isVariableStatement(statement.node)
		)
			return 'live';
		if (
			statement.kind === 'const' &&
			tsc.isVariableStatement(statement.node)
		) {
			const declaration =
				statement.node.declarationList.declarations.find(
					(item) =>
						tsc.isIdentifier(item.name) && item.name.text === name
				);
			if (
				declaration &&
				isFunctionInitializer(tsc, declaration.initializer)
			)
				return 'function';
		}
		if (
			statement.kind === 'untouched' &&
			tsc.isClassDeclaration(statement.node)
		)
			return 'class';

		return 'value';
	};
	// The runtime plan: every statement the runtime decides about.
	const planned = statements.filter(
		(statement) =>
			statement.kind !== 'import' &&
			statement.kind !== 'skip' &&
			statement.kind !== 'reexport' &&
			statement.kind !== 'export-list'
	);
	const planIndex = new Map(
		planned.map((statement, index) => [statement, index])
	);
	const idsOf = (statement: TopStatement) => {
		if (
			statement.kind === 'const' &&
			tsc.isVariableStatement(statement.node)
		)
			return statement.node.declarationList.declarations
				.filter((declaration) => declaration.initializer)
				.map(
					(declaration) =>
						`v:${bindingNames(tsc, declaration.name)[0]}`
				);
		if (statement.kind === 'let')
			return statement.declares.map((name) => `${statement.id}:${name}`);

		return [statement.id];
	};
	const plan: StatementPlan[] = planned.map((statement) => {
		const deps = new Set<number>();
		for (const reference of statement.refs) {
			const target = declaredBy.get(reference.name);
			const index = target ? planIndex.get(target) : undefined;
			if (index !== undefined && target !== statement) deps.add(index);
		}

		return {
			always: statement.kind === 'untouched',
			cell: statement.kind === 'let',
			deps: [...deps].sort((left, right) => left - right),
			hash: statement.ownHash,
			ids: idsOf(statement),
			imports: evalImports(statement).map((use) => [
				use.module,
				use.name,
				use.call ? 1 : 0
			])
		};
	});

	// Exports and the plan entry declaring each.
	const exports: HotModuleAnalysis['exports'] = {};
	const indexOf = (statement: TopStatement | undefined) =>
		statement ? (planIndex.get(statement) ?? -1) : -1;
	const recordExports = (statement: TopStatement) => {
		const { node } = statement;
		const exported = hasModifier(tsc, node, tsc.SyntaxKind.ExportKeyword);
		const isDefault = hasModifier(tsc, node, tsc.SyntaxKind.DefaultKeyword);
		if (statement.kind === 'default') {
			exports.default = { kind: 'value', plan: indexOf(statement) };

			return;
		}
		if (!exported) return;
		if (isDefault) {
			exports.default = {
				kind: statement.kind === 'function' ? 'function' : 'class',
				plan: indexOf(statement)
			};

			return;
		}
		for (const name of statement.declares)
			exports[name] = {
				kind: kindOfLocal(name),
				plan: indexOf(statement)
			};
	};
	for (const statement of statements) recordExports(statement);
	for (const [exported, local] of exportedLocals) {
		const statement = declaredBy.get(local);
		if (statement)
			exports[exported] = {
				kind: kindOfLocal(local),
				plan: indexOf(statement)
			};
		else if (imports.has(local))
			// Re-exporting an imported binding: the facade forwards it live.
			exports[exported] = { kind: 'live', plan: -1 };
	}

	// Rewrite.
	const edits: Edit[] = [];
	let editOrder = 0;
	const edit = (pos: number, del: number, text: string) =>
		edits.push({ del, order: editOrder++, pos, text });
	const cellNames = new Set<string>();
	for (const statement of statements)
		if (statement.kind === 'let')
			for (const name of statement.declares) cellNames.add(name);
	const quote = (value: string) => JSON.stringify(value);

	const rewriteConst = (node: TS.Statement) => {
		if (!tsc.isVariableStatement(node)) return;
		const isAsync = hasTopLevelAwait(tsc, node);
		for (const declaration of node.declarationList.declarations) {
			const init = declaration.initializer;
			if (!init) continue;
			const id = quote(`v:${bindingNames(tsc, declaration.name)[0]}`);
			edit(
				init.getStart(file),
				0,
				isAsync
					? `(await __absH.ka(${id},async()=>(`
					: `__absH.k(${id},()=>(`
			);
			edit(init.end, 0, isAsync ? ')))' : '))');
		}
	};

	const rewriteLet = (statement: TopStatement, start: number) => {
		const { node } = statement;
		if (!tsc.isVariableStatement(node)) return;
		const { declarations } = node.declarationList;
		const [first] = declarations;
		if (!first) return;
		edit(start, first.getStart(file) - start, '');
		const isAsync = hasTopLevelAwait(tsc, node);
		declarations.forEach((declaration, index) => {
			const name = bindingNames(tsc, declaration.name)[0] ?? '';
			const head = `${quote(name)},${quote(`${statement.id}:${name}`)}`;
			const init = declaration.initializer;
			const declStart = declaration.getStart(file);
			if (init) {
				edit(
					declStart,
					init.getStart(file) - declStart,
					isAsync
						? `await __absH.ca(${head},async()=>(`
						: `__absH.c(${head},()=>(`
				);
				edit(init.end, 0, '))');
			} else {
				edit(
					declStart,
					declaration.end - declStart,
					`__absH.c(${head},()=>undefined)`
				);
			}
			const next = declarations[index + 1];
			if (next)
				edit(
					declaration.end,
					next.getStart(file) - declaration.end,
					';'
				);
		});
	};

	const rewriteClass = (statement: TopStatement, start: number) => {
		const { node } = statement;
		if (!tsc.isClassDeclaration(node)) return;
		const exported = hasModifier(tsc, node, tsc.SyntaxKind.ExportKeyword);
		const isDefault = hasModifier(tsc, node, tsc.SyntaxKind.DefaultKeyword);
		const classKeyword = node
			.getChildren(file)
			.find((child) => child.kind === tsc.SyntaxKind.ClassKeyword);
		if (!classKeyword) return;
		const keywordStart = classKeyword.getStart(file);
		const name = node.name?.text;
		const keep = `__absH.k(${quote(statement.id)},()=>(`;
		if (isDefault && name) {
			edit(start, keywordStart - start, `const ${name}=${keep}`);
			edit(node.end, 0, `));export default ${name};`);
		} else if (isDefault) {
			edit(start, keywordStart - start, `export default ${keep}`);
			edit(node.end, 0, '));');
		} else {
			edit(
				start,
				keywordStart - start,
				`${exported ? 'export ' : ''}const ${name}=${keep}`
			);
			edit(node.end, 0, '));');
		}
	};

	const rewriteDefault = (statement: TopStatement) => {
		const { node } = statement;
		if (!tsc.isExportAssignment(node)) return;
		const isAsync = hasTopLevelAwait(tsc, node.expression);
		const id = quote(statement.id);
		edit(
			node.expression.getStart(file),
			0,
			isAsync
				? `(await __absH.ka(${id},async()=>(`
				: `__absH.k(${id},()=>(`
		);
		edit(node.expression.end, 0, isAsync ? ')))' : '))');
	};

	const rewriteRun = (statement: TopStatement, start: number) => {
		const { node } = statement;
		const isAsync = hasTopLevelAwait(tsc, node);
		const id = quote(statement.id);
		edit(
			start,
			0,
			isAsync
				? `await __absH.ra(${id},async()=>{`
				: `__absH.r(${id},()=>{`
		);
		edit(node.end, 0, '});');
	};

	const rewriteStatement = (statement: TopStatement) => {
		const start = statement.node.getStart(file);
		switch (statement.kind) {
			case 'const':
				rewriteConst(statement.node);
				break;
			case 'let':
				rewriteLet(statement, start);
				break;
			case 'class':
				rewriteClass(statement, start);
				break;
			case 'default':
				rewriteDefault(statement);
				break;
			case 'run':
				rewriteRun(statement, start);
				break;
			default:
				break;
		}
	};

	// Top-level `let`/`var` live in the module's persistent store.
	const rewriteCellReferences = (statement: TopStatement) => {
		if (statement.kind === 'import' || statement.kind === 'skip') return;
		for (const reference of statement.refs) {
			if (!cellNames.has(reference.name)) continue;
			const { node } = reference;
			const replacement = reference.shorthand
				? `${reference.name}:__absC.${reference.name}`
				: `__absC.${reference.name}`;
			edit(
				node.getStart(file),
				node.end - node.getStart(file),
				replacement
			);
		}
	};

	for (const statement of statements) rewriteStatement(statement);
	for (const statement of statements) rewriteCellReferences(statement);

	edits.sort(compareEdits);
	let code = source;
	for (const item of edits)
		code =
			code.slice(0, item.pos) +
			item.text +
			code.slice(item.pos + item.del);
	const exportKinds = Object.fromEntries(
		Object.entries(exports).map(([name, meta]) => [name, meta])
	);
	const prelude = `const __absH=globalThis.__absoluteHot.begin(${quote(canonicalPath)},${JSON.stringify(exportKinds)},${JSON.stringify(plan)});const __absC=__absH.cells;`;
	code = `${prelude}${code}\n;__absH.end();\n`;
	const analysis: HotModuleAnalysis = {
		code,
		exports,
		ok: true,
		plan,
		reexports
	};

	return analysis;
};

/** Facade lines for one export. */
const facadeExportLines = (
	name: string,
	kind: ExportKind,
	implSpecifier: string
) => {
	if (kind === 'live')
		return [`export { ${name} } from ${JSON.stringify(implSpecifier)};`];
	if (kind === 'function') {
		const body = `{return globalThis.__absoluteHot.forward(__absF,__absImpl,${JSON.stringify(name)},this,args,new.target);}`;

		return [
			name === 'default'
				? `export default function (...args)${body}`
				: `export function ${name}(...args)${body}`
		];
	}
	const local = name === 'default' ? '__absDefault' : name;

	return [
		`let ${local}=__absF.read(${JSON.stringify(name)});__absF.watch(${JSON.stringify(name)},(value)=>{${local}=value;});`,
		name === 'default'
			? 'export { __absDefault as default };'
			: `export { ${name} };`
	];
};

/** Facade source for a module: what importers load. Function exports are
 *  hoisted forwarders to the latest version; other exports are live
 *  bindings the runtime reassigns. */
export const facadeSource = (
	canonicalPath: string,
	implSpecifier: string,
	analysis: HotModuleAnalysis
) => {
	const lines = [
		`import * as __absImpl from ${JSON.stringify(implSpecifier)};`,
		`var __absF=globalThis.__absoluteHot.facade(${JSON.stringify(canonicalPath)},__absImpl);`
	];
	for (const [name, meta] of Object.entries(analysis.exports))
		lines.push(...facadeExportLines(name, meta.kind, implSpecifier));
	lines.push(...analysis.reexports);

	return `${lines.join('\n')}\n`;
};

/** Resolve an import specifier from `fromFile` to a real path, or
 *  `undefined` for packages and unresolvable specifiers. */
export const resolveFrom =
	(fromFile: string, isManaged: (path: string) => boolean) =>
	(specifier: string) => {
		try {
			const resolved = Bun.resolveSync(specifier, dirname(fromFile));

			return isManaged(resolved) ? resolved : undefined;
		} catch {
			return undefined;
		}
	};
