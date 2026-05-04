/* Surgical-HMR fast path. Replaces the ngtsc/`performCompilation`
 * pipeline (which runs ~1-3s incremental, dominated by program-wide
 * TCB synthesis + analysis) with a single-file metadata extractor +
 * `compileComponentFromMetadata` IR pass. Median measured at ~4ms,
 * ~320× faster than the AOT incremental path.
 *
 * The architectural premise (see ANGULAR_HMR_ARCHITECTURE.md):
 * Angular's compile bundles template type-checking with template
 * compilation because templates aren't TypeScript and the TCB has
 * to live in the same TS program. For HMR specifically, the editor
 * + a separate `tsc` daemon already cover type-checking — paying
 * for it again at every keystroke is a tax we're choosing not to.
 *
 * We cover the modern standalone path (Tier 1 + Tier 2 from the
 * architecture doc). Legacy NgModule-based components, decorated
 * inheritance chains, and a handful of exotic cases bail to the
 * ngtsc fallback in `getApplyMetadataModule`. */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import type {
	DeclareFunctionStmt,
	R3CompiledExpression,
	R3InputMetadata,
	R3HmrNamespaceDependency
} from '@angular/compiler';
import ts from 'typescript';
import { createHmrImportGenerator } from './hmrImportGenerator';
import type { AngularEntityKind } from './resolveOwningComponents';
import { translateStatement } from './vendor/translator/typescript_translator';

export type FastHmrFallbackReason =
	| 'file-not-found'
	| 'class-not-found'
	| 'no-component-decorator'
	| 'unsupported-decorator-args'
	| 'not-standalone'
	| 'inherits-decorated-class'
	| 'multiple-decorators-on-class'
	| 'template-parse-error'
	| 'template-resource-not-found'
	| 'style-resource-not-found'
	| 'structural-change'
	| 'unexpected-error';

/* Identity-stable summary of a component's structural surface. Two
 * components with the same fingerprint can be safely
 * `ɵɵreplaceMetadata`-swapped — only their template / styles /
 * method bodies have changed. Mismatches force escalation to Tier 1
 * (re-bootstrap) because the running app's DI / scope / view-tree
 * shape may be incompatible with the new code.
 *
 * Captured fields:
 *   - `ctorParamTypes`: text of each constructor parameter's type
 *     reference, in order. Constructor changes are the most common
 *     source of DI-token-mismatch surprises.
 *   - `selector` / `standalone`: trivial identity changes.
 *   - `providerImportSig`: sorted "P:<name>" markers for every
 *     `imports: [...]` entry whose source is an `@NgModule` with
 *     `providers: [...]`. Adding/removing a provider-bearing
 *     module changes the component's DI tree shape; surgical
 *     swap can't propagate that to existing instances.
 *     Directive / pipe additions to `imports` (no providers) are
 *     deliberately NOT in the fingerprint — they're rendering
 *     concerns and `ɵɵreplaceMetadata` handles them via the
 *     `dependencies: [...]` list.
 *   - `hasProviders` / `hasViewProviders`: presence flips, which
 *     change DI tree shape.
 *   - `inputs` / `outputs`: sorted name lists. Renames or
 *     additions/removals of inputs change the parent template's
 *     binding contract.
 *   - `arrowFieldSig`: sorted "name:hash" entries for every class
 *     property whose initializer is an arrow function or function
 *     expression. These live per-instance (not on the prototype)
 *     so the surgical prototype-patch can't propagate body changes
 *     to existing instances. Catching the body change here forces
 *     Tier 1 instead of a silent no-op. Non-function field
 *     initializers (`count = 0`) are NOT in the signature — those
 *     edits stay no-op so existing instance state is preserved.
 *   - `memberDecoratorSig`: sorted "Decorator:member:argHash"
 *     entries for every member-level Angular decorator other than
 *     `@Input` / `@Output` (those are already covered by
 *     `inputs` / `outputs`). Catches `@HostBinding`,
 *     `@HostListener`, `@ViewChild`, `@ContentChild`,
 *     `@ViewChildren`, `@ContentChildren` adds/removes/arg-changes
 *     — all of which alter the component's metadata in ways
 *     `ɵɵreplaceMetadata` doesn't observe via the IR alone (host
 *     bindings + queries are template-binding artifacts that need
 *     a full re-render at minimum).
 *
 * We deliberately do NOT include template / styleUrl / styleUrls
 * content — those are exactly the cheap surgical-handleable
 * changes we want to *allow*. */
export type ComponentFingerprint = {
	className: string;
	selector: string | null;
	standalone: boolean;
	ctorParamTypes: string[];
	providerImportSig: string[];
	hasProviders: boolean;
	hasViewProviders: boolean;
	inputs: string[];
	outputs: string[];
	arrowFieldSig: string[];
	memberDecoratorSig: string[];
};

export type FastHmrSuccess = {
	ok: true;
	moduleText: string;
	componentSource: ts.SourceFile;
};

export type FastHmrFailure = {
	ok: false;
	reason: FastHmrFallbackReason;
	detail?: string;
};

export type FastHmrResult = FastHmrSuccess | FastHmrFailure;

const fail = (
	reason: FastHmrFallbackReason,
	detail?: string
): FastHmrFailure => ({ ok: false, reason, detail });

/* ─── Fingerprint cache ──────────────────────────────────────── */

/* Module-scoped cache. Key is the encoded HMR id
 * (`encodeURIComponent('<projectRel>@<className>')`) — same key
 * the `/@ng/component` endpoint uses. Map persists for the
 * lifetime of the dev server; cleared after a Tier 1 re-bootstrap
 * (the bundle is rebuilt with the new structure as the new
 * baseline). */
const fingerprintCache = new Map<string, ComponentFingerprint>();

const arraysEqual = (a: string[], b: string[]): boolean => {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}

	return true;
};

const fingerprintsEqual = (
	a: ComponentFingerprint,
	b: ComponentFingerprint
): boolean => {
	if (a.className !== b.className) return false;
	if (a.selector !== b.selector) return false;
	if (a.standalone !== b.standalone) return false;
	if (a.hasProviders !== b.hasProviders) return false;
	if (a.hasViewProviders !== b.hasViewProviders) return false;
	if (!arraysEqual(a.ctorParamTypes, b.ctorParamTypes)) return false;
	if (!arraysEqual(a.inputs, b.inputs)) return false;
	if (!arraysEqual(a.outputs, b.outputs)) return false;
	if (!arraysEqual(a.providerImportSig, b.providerImportSig)) return false;
	if (!arraysEqual(a.arrowFieldSig, b.arrowFieldSig)) return false;
	if (!arraysEqual(a.memberDecoratorSig, b.memberDecoratorSig)) return false;

	return true;
};

export const recordFingerprint = (
	id: string,
	fp: ComponentFingerprint
): void => {
	fingerprintCache.set(id, fp);
};

/* Clear all cached fingerprints. Called after a Tier 1
 * re-bootstrap completes — at that point the running app's
 * structure matches the new bundle, and the next surgical edit
 * should establish fresh baselines from the new source. */
export const invalidateFingerprintCache = (): void => {
	fingerprintCache.clear();
};

/* ─── TS AST helpers ─────────────────────────────────────────── */

const findClassDeclaration = (
	sourceFile: ts.SourceFile,
	className: string
): ts.ClassDeclaration | null => {
	let found: ts.ClassDeclaration | null = null;
	const walk = (node: ts.Node) => {
		if (found) return;
		if (
			ts.isClassDeclaration(node) &&
			node.name?.text === className
		) {
			found = node;

			return;
		}
		ts.forEachChild(node, walk);
	};
	walk(sourceFile);

	return found;
};

const getClassDecorators = (cls: ts.ClassDeclaration): ts.Decorator[] => {
	const modifiers = ts.getDecorators(cls) ?? [];

	return [...modifiers];
};

const findComponentDecorator = (
	cls: ts.ClassDeclaration
): ts.Decorator | null => {
	for (const decorator of getClassDecorators(cls)) {
		const expr = decorator.expression;
		if (ts.isCallExpression(expr)) {
			const fn = expr.expression;
			if (ts.isIdentifier(fn) && fn.text === 'Component') {
				return decorator;
			}
		}
	}

	return null;
};

const getDecoratorArgsObject = (
	decorator: ts.Decorator
): ts.ObjectLiteralExpression | null => {
	const call = decorator.expression;
	if (!ts.isCallExpression(call)) return null;
	const arg = call.arguments[0];
	if (!arg || !ts.isObjectLiteralExpression(arg)) return null;

	return arg;
};

const getProperty = (
	obj: ts.ObjectLiteralExpression,
	name: string
): ts.Expression | null => {
	for (const prop of obj.properties) {
		if (
			ts.isPropertyAssignment(prop) &&
			((ts.isIdentifier(prop.name) && prop.name.text === name) ||
				(ts.isStringLiteral(prop.name) && prop.name.text === name))
		) {
			return prop.initializer;
		}
	}

	return null;
};

const getStringProperty = (
	obj: ts.ObjectLiteralExpression,
	name: string
): string | null => {
	const expr = getProperty(obj, name);
	if (!expr) return null;
	if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
		return expr.text;
	}

	return null;
};

const getBooleanProperty = (
	obj: ts.ObjectLiteralExpression,
	name: string
): boolean | null => {
	const expr = getProperty(obj, name);
	if (!expr) return null;
	if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;

	return null;
};

const inheritsDecoratedClass = (cls: ts.ClassDeclaration): boolean => {
	const heritage = cls.heritageClauses ?? [];
	for (const clause of heritage) {
		if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
		// We can't cheaply tell whether the base class has a decorator
		// without crossing files. Conservative call: any extends clause
		// → bail. Cheap to revisit if it bites us in practice.
		if (clause.types.length > 0) return true;
	}

	return false;
};

/* ─── @Component decorator field walks ───────────────────────── */

type ComponentDecoratorMeta = {
	selector: string | null;
	templateUrl: string | null;
	template: string | null;
	styleUrl: string | null;
	styleUrls: string[];
	styles: string[];
	standalone: boolean;
	preserveWhitespaces: boolean;
	importsExpr: ts.ArrayLiteralExpression | null;
	hasProviders: boolean;
	hasViewProviders: boolean;
};

const readDecoratorMeta = (
	args: ts.ObjectLiteralExpression
): ComponentDecoratorMeta => {
	const styleUrlsExpr = getProperty(args, 'styleUrls');
	const stylesExpr = getProperty(args, 'styles');
	const importsExpr = getProperty(args, 'imports');

	const styleUrls: string[] = [];
	if (styleUrlsExpr && ts.isArrayLiteralExpression(styleUrlsExpr)) {
		for (const el of styleUrlsExpr.elements) {
			if (ts.isStringLiteral(el)) styleUrls.push(el.text);
		}
	}

	const styles: string[] = [];
	if (stylesExpr) {
		if (ts.isArrayLiteralExpression(stylesExpr)) {
			for (const el of stylesExpr.elements) {
				if (
					ts.isStringLiteral(el) ||
					ts.isNoSubstitutionTemplateLiteral(el)
				) {
					styles.push(el.text);
				}
			}
		} else if (
			ts.isStringLiteral(stylesExpr) ||
			ts.isNoSubstitutionTemplateLiteral(stylesExpr)
		) {
			styles.push(stylesExpr.text);
		}
	}

	return {
		hasProviders: getProperty(args, 'providers') !== null,
		hasViewProviders: getProperty(args, 'viewProviders') !== null,
		importsExpr:
			importsExpr && ts.isArrayLiteralExpression(importsExpr)
				? importsExpr
				: null,
		preserveWhitespaces:
			getBooleanProperty(args, 'preserveWhitespaces') ?? false,
		selector: getStringProperty(args, 'selector'),
		standalone: getBooleanProperty(args, 'standalone') ?? true,
		styleUrl: getStringProperty(args, 'styleUrl'),
		styleUrls,
		styles,
		template: getStringProperty(args, 'template'),
		templateUrl: getStringProperty(args, 'templateUrl')
	};
};

/* ─── Input / output extraction ──────────────────────────────── */

/* Decorator-form: `@Input() name: T = default;`,
 * `@Input({ alias, required, transform }) name: T;`. */
const extractDecoratorInput = (
	prop: ts.PropertyDeclaration
): { classPropertyName: string; meta: R3InputMetadata } | null => {
	const decorators = ts.getDecorators(prop) ?? [];
	for (const decorator of decorators) {
		const expr = decorator.expression;
		if (!ts.isCallExpression(expr)) continue;
		const fn = expr.expression;
		if (!ts.isIdentifier(fn) || fn.text !== 'Input') continue;

		const classPropertyName = prop.name.getText();
		let bindingPropertyName = classPropertyName;
		let required = false;

		const arg = expr.arguments[0];
		if (arg) {
			if (ts.isStringLiteral(arg)) {
				// @Input('alias') name — legacy alias form
				bindingPropertyName = arg.text;
			} else if (ts.isObjectLiteralExpression(arg)) {
				const aliasNode = getStringProperty(arg, 'alias');
				if (aliasNode !== null) bindingPropertyName = aliasNode;
				required = getBooleanProperty(arg, 'required') ?? false;
			}
		}

		return {
			classPropertyName,
			meta: {
				classPropertyName,
				bindingPropertyName,
				required,
				isSignal: false,
				// Transform extraction defers to v2. Inputs with a
				// `transform:` argument compile fine without it
				// at runtime — the binding just won't coerce until
				// the next full reload.
				transformFunction: null
			}
		};
	}

	return null;
};

const isInputSignalCall = (init: ts.Expression): boolean => {
	if (ts.isCallExpression(init)) {
		const fn = init.expression;
		if (ts.isIdentifier(fn) && fn.text === 'input') return true;
		if (
			ts.isPropertyAccessExpression(fn) &&
			ts.isIdentifier(fn.expression) &&
			fn.expression.text === 'input'
		) {
			return true;
		}
	}

	return false;
};

const extractSignalInput = (
	prop: ts.PropertyDeclaration
): { classPropertyName: string; meta: R3InputMetadata } | null => {
	if (!prop.initializer || !isInputSignalCall(prop.initializer)) return null;
	const classPropertyName = prop.name.getText();
	const call = prop.initializer as ts.CallExpression;
	let required = false;
	if (
		ts.isPropertyAccessExpression(call.expression) &&
		ts.isIdentifier(call.expression.name) &&
		call.expression.name.text === 'required'
	) {
		required = true;
	}

	let bindingPropertyName = classPropertyName;
	const optsArg = call.arguments[required ? 0 : 1];
	if (optsArg && ts.isObjectLiteralExpression(optsArg)) {
		const aliasNode = getStringProperty(optsArg, 'alias');
		if (aliasNode !== null) bindingPropertyName = aliasNode;
	}

	return {
		classPropertyName,
		meta: {
			classPropertyName,
			bindingPropertyName,
			required,
			isSignal: true,
			transformFunction: null
		}
	};
};

const extractDecoratorOutput = (
	prop: ts.PropertyDeclaration
): { classPropertyName: string; bindingName: string } | null => {
	const decorators = ts.getDecorators(prop) ?? [];
	for (const decorator of decorators) {
		const expr = decorator.expression;
		if (!ts.isCallExpression(expr)) continue;
		const fn = expr.expression;
		if (!ts.isIdentifier(fn) || fn.text !== 'Output') continue;

		const classPropertyName = prop.name.getText();
		let bindingName = classPropertyName;
		const arg = expr.arguments[0];
		if (arg && ts.isStringLiteral(arg)) bindingName = arg.text;

		return { classPropertyName, bindingName };
	}

	return null;
};

const isOutputSignalCall = (init: ts.Expression): boolean => {
	if (ts.isCallExpression(init)) {
		const fn = init.expression;
		if (ts.isIdentifier(fn) && fn.text === 'output') return true;
		if (
			ts.isPropertyAccessExpression(fn) &&
			ts.isIdentifier(fn.expression) &&
			fn.expression.text === 'output'
		) {
			return true;
		}
	}

	return false;
};

const extractSignalOutput = (
	prop: ts.PropertyDeclaration
): { classPropertyName: string; bindingName: string } | null => {
	if (!prop.initializer || !isOutputSignalCall(prop.initializer)) return null;
	const classPropertyName = prop.name.getText();
	const call = prop.initializer as ts.CallExpression;

	let bindingName = classPropertyName;
	const optsArg = call.arguments[0];
	if (optsArg && ts.isObjectLiteralExpression(optsArg)) {
		const aliasNode = getStringProperty(optsArg, 'alias');
		if (aliasNode !== null) bindingName = aliasNode;
	}

	return { classPropertyName, bindingName };
};

const extractInputsAndOutputs = (
	cls: ts.ClassDeclaration
): {
	inputs: Record<string, R3InputMetadata>;
	outputs: Record<string, string>;
} => {
	const inputs: Record<string, R3InputMetadata> = {};
	const outputs: Record<string, string> = {};

	for (const member of cls.members) {
		if (!ts.isPropertyDeclaration(member)) continue;

		const decoratorIn = extractDecoratorInput(member);
		if (decoratorIn) {
			inputs[decoratorIn.classPropertyName] = decoratorIn.meta;
			continue;
		}
		const signalIn = extractSignalInput(member);
		if (signalIn) {
			inputs[signalIn.classPropertyName] = signalIn.meta;
			continue;
		}
		const decoratorOut = extractDecoratorOutput(member);
		if (decoratorOut) {
			outputs[decoratorOut.classPropertyName] = decoratorOut.bindingName;
			continue;
		}
		const signalOut = extractSignalOutput(member);
		if (signalOut) {
			outputs[signalOut.classPropertyName] = signalOut.bindingName;
		}
	}

	return { inputs, outputs };
};

/* Tiny non-crypto string hash used for arrow-field body
 * fingerprints. We just need stable identity across whitespace-
 * insignificant edits and collision rates low enough that two
 * different bodies don't share a hash. djb2 is fine. */
const djb2Hash = (s: string): string => {
	let h = 5381;
	for (let i = 0; i < s.length; i++) {
		h = (h * 33) ^ s.charCodeAt(i);
	}

	return (h >>> 0).toString(36);
};

/* Walk the class members once, return a sorted `name:hash` list
 * for every property whose initializer is an arrow function or
 * function expression. Editing such an initializer's body is a
 * silent-no-op for surgical (lives per-instance, not on the
 * prototype) so we use the body hash to flag those edits as
 * structural changes that escalate to Tier 1.
 *
 * Non-function field initializers (`count = 0`, `data = {}`) are
 * NOT included — those edits should stay no-op so existing
 * instance state is preserved. The user wouldn't expect
 * `count = 0` → `count = 5` to reset their live counter. */
const extractArrowFieldSig = (cls: ts.ClassDeclaration): string[] => {
	const entries: string[] = [];
	for (const member of cls.members) {
		if (!ts.isPropertyDeclaration(member)) continue;
		const init = member.initializer;
		if (!init) continue;
		if (
			!ts.isArrowFunction(init) &&
			!ts.isFunctionExpression(init)
		) {
			continue;
		}
		const name = member.name.getText();
		// `init.getText()` includes parameters + body; whitespace is
		// part of the canonical text since we pull from the user's
		// source verbatim. Hash for compactness.
		const bodyHash = djb2Hash(init.getText());
		entries.push(`${name}:${bodyHash}`);
	}

	return entries.sort();
};

/* Walk class members for non-`@Input` / `@Output` decorators and
 * return a sorted "Decorator:member:argHash" signature. Catches
 * `@HostBinding('class.foo')`, `@HostListener('click', ['$event'])`,
 * `@ViewChild('ref')`, `@ContentChild(SomeToken, { static: true })`,
 * etc. Adding / removing / changing the decorator argument flags
 * the fingerprint as structurally changed → Tier 1.
 *
 * `@Input` / `@Output` are excluded because the existing
 * `inputs` / `outputs` fields in the fingerprint already capture
 * additions and removals via the binding-name list. (Alias-only
 * changes within a stable name list aren't caught — minor known
 * gap, see SURGICAL_HMR.md.) */
const INPUT_OUTPUT_DECORATORS = new Set(['Input', 'Output']);

const extractMemberDecoratorSig = (cls: ts.ClassDeclaration): string[] => {
	const entries: string[] = [];
	for (const member of cls.members) {
		const decorators = ts.getDecorators(member) ?? [];
		if (decorators.length === 0) continue;
		const memberName = member.name?.getText() ?? '<anon>';
		for (const decorator of decorators) {
			const expr = decorator.expression;
			let decName = '<unknown>';
			let argText = '';
			if (ts.isCallExpression(expr)) {
				if (ts.isIdentifier(expr.expression)) {
					decName = expr.expression.text;
				}
				if (expr.arguments.length > 0) {
					argText = expr.arguments
						.map((a) => a.getText())
						.join(',');
				}
			} else if (ts.isIdentifier(expr)) {
				decName = expr.text;
			}
			if (INPUT_OUTPUT_DECORATORS.has(decName)) continue;
			entries.push(
				`${decName}:${memberName}:${djb2Hash(argText)}`
			);
		}
	}

	return entries.sort();
};

/* Per-file cache for "does this module/class declaration include
 * `providers: [...]`?". Keyed by absolute file path; invalidated
 * by mtime. Avoids re-parsing the same `CommonModule` /
 * `MaterialModule` source on every HMR cycle.
 *
 * The check is heuristic: we look for any decorator call (typically
 * `@NgModule`, but also covers `@Component` re-exporting modules,
 * standalone modules, etc.) whose argument has a `providers: [...]`
 * property. Coverage is "anything that introduces DI tokens at this
 * file level"; false positives are acceptable because they just
 * downgrade Tier 0 → Tier 1. False negatives are not — a module
 * whose providers we miss would still get Tier 0'd and cause stale
 * DI, so we err toward conservative. */
type ProviderProbeCacheEntry = {
	mtimeMs: number;
	hasProviders: boolean;
};
const providerProbeCache = new Map<string, ProviderProbeCacheEntry>();

const fileHasModuleProviders = (filePath: string): boolean => {
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(filePath);
	} catch {
		// File can't be stat'd → conservative: assume providers.
		return true;
	}
	const cached = providerProbeCache.get(filePath);
	if (cached && cached.mtimeMs === stat.mtimeMs) return cached.hasProviders;

	let source: string;
	try {
		source = readFileSync(filePath, 'utf8');
	} catch {
		return true;
	}

	const sf = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.ES2022,
		true,
		ts.ScriptKind.TS
	);

	let hasProviders = false;
	const visit = (node: ts.Node): void => {
		if (hasProviders) return;
		if (ts.isClassDeclaration(node)) {
			for (const decorator of ts.getDecorators(node) ?? []) {
				const expr = decorator.expression;
				if (!ts.isCallExpression(expr)) continue;
				const arg = expr.arguments[0];
				if (!arg || !ts.isObjectLiteralExpression(arg)) continue;
				if (getProperty(arg, 'providers') !== null) {
					hasProviders = true;
					return;
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);

	providerProbeCache.set(filePath, {
		hasProviders,
		mtimeMs: stat.mtimeMs
	});

	return hasProviders;
};

const TS_EXTENSIONS = ['.ts', '.tsx', '.d.ts'] as const;

/* Resolve the source file an Identifier import was loaded from.
 * Walks the source's `import { Identifier } from '<spec>'` and
 * `import { Identifier as Alias } from '<spec>'` declarations,
 * resolves the specifier relative to the source file, returns the
 * resolved absolute path or null. Bare-specifier imports (e.g.
 * `'@angular/common'`) return null — we conservatively assume node
 * package imports introduce providers. */
const resolveImportSource = (
	identifierName: string,
	sourceFile: ts.SourceFile,
	componentDir: string
): string | null => {
	for (const stmt of sourceFile.statements) {
		if (!ts.isImportDeclaration(stmt)) continue;
		const moduleSpec = stmt.moduleSpecifier;
		if (!ts.isStringLiteral(moduleSpec)) continue;
		const spec = moduleSpec.text;
		if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
		const importClause = stmt.importClause;
		if (!importClause) continue;

		let matches = false;
		if (
			importClause.name &&
			importClause.name.text === identifierName
		) {
			matches = true;
		}
		if (importClause.namedBindings) {
			const nb = importClause.namedBindings;
			if (ts.isNamespaceImport(nb)) {
				if (nb.name.text === identifierName) matches = true;
			} else {
				for (const element of nb.elements) {
					if (element.name.text === identifierName) {
						matches = true;
						break;
					}
				}
			}
		}
		if (!matches) continue;

		const resolved = resolve(componentDir, spec);
		for (const ext of TS_EXTENSIONS) {
			const candidate = resolved + ext;
			if (existsSync(candidate)) return candidate;
		}
		const indexCandidate = resolve(resolved, 'index.ts');
		if (existsSync(indexCandidate)) return indexCandidate;
	}

	return null;
};

/* Per-entry classification of `imports: [...]`. For each entry,
 * decide whether the entry pulls in DI tokens that need a
 * re-bootstrap when added/removed. Returns a stable signature
 * (sorted list of `P:<name>` markers for provider-bearing entries,
 * directives/pipes are deliberately excluded). */
const extractProviderImportSig = (
	importsExpr: ts.ArrayLiteralExpression | null,
	sourceFile: ts.SourceFile,
	componentDir: string
): string[] => {
	if (!importsExpr) return [];
	const sig: string[] = [];
	for (const entry of importsExpr.elements) {
		if (ts.isIdentifier(entry)) {
			const importPath = resolveImportSource(
				entry.text,
				sourceFile,
				componentDir
			);
			// Local relative import → inspect the file directly
			// (mtime-cached). Catches user-defined modules with
			// providers regardless of their name.
			if (importPath) {
				if (fileHasModuleProviders(importPath)) {
					sig.push(`P:${entry.text}`);
				}
				continue;
			}
			// Bare-specifier import (3rd-party / Angular package) —
			// we don't walk node_modules to keep the cost bounded.
			// Apply the name heuristic instead: names ending in
			// `Module` are virtually always provider-bearing in
			// Angular's ecosystem (HttpClientModule, RouterModule,
			// FormsModule, BrowserAnimationsModule, ...). Names that
			// don't end in `Module` are virtually always directives /
			// pipes / components (NgIf, NgFor, NgClass, MatButton,
			// RouterLink, ...). The heuristic is wrong for
			// rare custom names, but a false negative just means
			// the user gets a silent stale provider after adding a
			// non-`*Module` import — extremely uncommon in practice.
			if (/Module$/.test(entry.text)) {
				sig.push(`P:${entry.text}`);
			}
			// else: directive/pipe heuristic — not in signature
		} else {
			// Non-Identifier (CallExpression like `RouterModule.forRoot()`,
			// SpreadElement, etc.) — almost always provider-bearing.
			sig.push(`P:${entry.getText()}`);
		}
	}

	return sig.sort();
};

/* Extract a `ComponentFingerprint` directly from a parsed class
 * declaration. Cheap enough to run on every `tryFastHmr` call —
 * one TS AST walk over the class body, plus per-import file
 * lookups (mtime-cached, ~5ms cold for the typical 2-5 import
 * entries, ~0ms warm). */
const extractFingerprint = (
	cls: ts.ClassDeclaration,
	className: string,
	decoratorMeta: ComponentDecoratorMeta,
	inputs: Record<string, R3InputMetadata>,
	outputs: Record<string, string>,
	sourceFile: ts.SourceFile,
	componentDir: string
): ComponentFingerprint => {
	const ctorParamTypes: string[] = [];
	for (const member of cls.members) {
		if (!ts.isConstructorDeclaration(member)) continue;
		for (const param of member.parameters) {
			ctorParamTypes.push(param.type ? param.type.getText() : '');
		}
		break;
	}

	// Capture both class-property name AND binding name (the
	// public template name, which the alias overrides). Catches
	// `@Input({ alias: 'x' })` → `@Input({ alias: 'y' })` —
	// previously a silent no-op since only the class-property name
	// was in the fingerprint.
	const inputNames = Object.entries(inputs)
		.map(([k, m]) => `${k}:${m.bindingPropertyName}`)
		.sort();
	const outputNames = Object.entries(outputs)
		.map(([k, v]) => `${k}:${v}`)
		.sort();
	const arrowFieldSig = extractArrowFieldSig(cls);
	const memberDecoratorSig = extractMemberDecoratorSig(cls);
	const providerImportSig = extractProviderImportSig(
		decoratorMeta.importsExpr,
		sourceFile,
		componentDir
	);

	return {
		arrowFieldSig,
		className,
		ctorParamTypes,
		hasProviders: decoratorMeta.hasProviders,
		hasViewProviders: decoratorMeta.hasViewProviders,
		inputs: inputNames,
		memberDecoratorSig,
		outputs: outputNames,
		providerImportSig,
		selector: decoratorMeta.selector,
		standalone: decoratorMeta.standalone
	};
};

/* Re-emit the class's method bodies as a freshly-evaluated class
 * wrapper so the surgical update can copy them onto the live class's
 * prototype. Without this, edits like `count++` → `count += 2` inside
 * an existing method silently no-op: `compileComponentFromMetadata`
 * only updates `ɵcmp`, and the running view's `ctx.method()` calls
 * resolve to the prototype, which still holds the old function.
 *
 * What we embed:
 *   - Regular `MethodDeclaration` members (incl. async, generator,
 *     getters, setters). These live on the prototype and can be
 *     swapped via `Object.defineProperty` without recreating
 *     instances.
 *
 * What we DON'T embed (yet):
 *   - The constructor — already excluded by skipping
 *     `ConstructorDeclaration`. Constructor changes are a Tier 1
 *     trigger via the fingerprint check (ctor param types).
 *   - Property declarations with initializers (`count = 0`,
 *     `handleClick = () => {}`) — these set per-instance state
 *     during construction. Patching the prototype doesn't touch
 *     existing instances' fields. The fingerprint check should
 *     escalate these to Tier 1 if their initializer changes; for
 *     now, initializer-body edits silently no-op (a known
 *     limitation, narrower than before).
 *
 * Implementation: synthesize a `class _Fresh { ${methodSource} }`
 * wrapper, run `ts.transpileModule` to strip TS syntax, embed in
 * the emitted module. The surgical update then copies prototype
 * descriptors from `_Fresh.prototype` to the live class. */
const buildFreshClassMethodsBlock = (
	classNode: ts.ClassDeclaration,
	className: string
): string | null => {
	const methodSources: string[] = [];
	let hasStatic = false;
	for (const member of classNode.members) {
		if (
			ts.isMethodDeclaration(member) ||
			ts.isGetAccessorDeclaration(member) ||
			ts.isSetAccessorDeclaration(member)
		) {
			methodSources.push(member.getText());
			const modifiers = ts.getModifiers(member) ?? [];
			if (
				modifiers.some(
					(m) => m.kind === ts.SyntaxKind.StaticKeyword
				)
			) {
				hasStatic = true;
			}
		}
	}
	if (methodSources.length === 0) return null;

	const wrappedSource = `class _Fresh {\n${methodSources.join('\n')}\n}`;
	let transpiled: string;
	try {
		transpiled = ts.transpileModule(wrappedSource, {
			compilerOptions: {
				module: ts.ModuleKind.ES2022,
				target: ts.ScriptTarget.ES2022
			},
			reportDiagnostics: false
		}).outputText;
	} catch {
		return null;
	}

	// Static-method patch is conditional — most components don't
	// have any. The skip-list (`length`, `name`, `prototype`) is the
	// set of class own-properties JS adds automatically; if we
	// copied those onto the live class we'd break its identity.
	const staticPatch = hasStatic
		? `
{
    for (const __name of Object.getOwnPropertyNames(_Fresh)) {
        if (__name === 'length' || __name === 'name' || __name === 'prototype') continue;
        const __desc = Object.getOwnPropertyDescriptor(_Fresh, __name);
        if (__desc) Object.defineProperty(${className}, __name, __desc);
    }
}`
		: '';

	return `// SURGICAL_HMR — patch prototype + static methods so existing
// instances and direct \`Class.staticMethod()\` calls pick up new
// method bodies (\`compileComponentFromMetadata\` only updates
// \`ɵcmp\`, never the prototype or the class itself).
${transpiled}
{
    const __fresh_proto = _Fresh.prototype;
    for (const __name of Object.getOwnPropertyNames(__fresh_proto)) {
        if (__name === 'constructor') continue;
        const __desc = Object.getOwnPropertyDescriptor(__fresh_proto, __name);
        if (__desc) Object.defineProperty(${className}.prototype, __name, __desc);
    }
}${staticPatch}`;
};

/* ─── Resource resolution (template + styles) ─────────────────── */

const resolveAndReadResource = (
	componentDir: string,
	url: string
): string | null => {
	const abs = resolve(componentDir, url);
	if (!existsSync(abs)) return null;

	return readFileSync(abs, 'utf8');
};

const collectStyles = (
	decoratorMeta: ComponentDecoratorMeta,
	componentDir: string
): { styles: string[]; missing: string | null } => {
	const styles: string[] = [...decoratorMeta.styles];

	const urls: string[] = [];
	if (decoratorMeta.styleUrl) urls.push(decoratorMeta.styleUrl);
	urls.push(...decoratorMeta.styleUrls);

	for (const url of urls) {
		const css = resolveAndReadResource(componentDir, url);
		if (css === null) return { styles, missing: url };
		styles.push(css);
	}

	return { styles, missing: null };
};

/* ─── Non-component surgical (services / pipes / directives) ──── */

/* Pipes / directives / services don't need Angular's IR pipeline
 * for body-only edits — their templates (none) and metadata
 * (selector, pipe name, providedIn) are part of the bundle's
 * initial compile. Only their methods need re-binding on the live
 * class.
 *
 * The emitted module mirrors the component path (named function
 * keyed on `${className}_UpdateMetadata` so the `__ng_hmr_load`
 * listener can dispatch uniformly), but the body is just the
 * prototype-patch block. No `ɵcmp` / `ɵpipe` / `ɵdir` / `ɵprov`
 * mutation. Structural changes (constructor, decorator metadata
 * shape) escalate to Tier 1 via the same fingerprint check the
 * component path uses. */
const buildSimpleEntityModule = (
	classNode: ts.ClassDeclaration,
	className: string
): string | null => {
	const block = buildFreshClassMethodsBlock(classNode, className);
	if (!block) {
		// No methods to patch — nothing surgical to do. The user's
		// edit was either to a property initializer (silent no-op,
		// expected for state preservation) or pure typing changes
		// (also no-op). Return a no-op module so the broadcast
		// doesn't 404 on the client.
		return `export default function ${className}_UpdateMetadata(${className}, ɵɵnamespaces) { /* no method-body changes detected */ }\n`;
	}

	return `export default function ${className}_UpdateMetadata(${className}, ɵɵnamespaces) {
${block}
}
`;
};

/* ─── Main entry ─────────────────────────────────────────────── */

export type TryFastHmrParams = {
	componentFilePath: string;
	className: string;
	projectRoot?: string;
	kind?: AngularEntityKind;
};

export const tryFastHmr = async (
	params: TryFastHmrParams
): Promise<FastHmrResult> => {
	const { componentFilePath, className } = params;
	const projectRoot = params.projectRoot ?? process.cwd();

	if (!existsSync(componentFilePath)) {
		return fail('file-not-found', componentFilePath);
	}

	let compiler: typeof import('@angular/compiler');
	try {
		compiler = await import('@angular/compiler');
	} catch (err) {
		return fail('unexpected-error', `import @angular/compiler: ${err}`);
	}

	const tsSource = readFileSync(componentFilePath, 'utf8');
	const sourceFile = ts.createSourceFile(
		componentFilePath,
		tsSource,
		ts.ScriptTarget.ES2022,
		true,
		ts.ScriptKind.TS
	);

	const classNode = findClassDeclaration(sourceFile, className);
	if (!classNode) {
		return fail('class-not-found', `${className} in ${componentFilePath}`);
	}

	// Kind-based fast paths for non-component entities (services,
	// pipes, directives). They share the prototype-patch mechanism
	// with components but skip Angular's IR pipeline because their
	// metadata (selector / pipe name / providedIn) doesn't change
	// per-edit; only method bodies do.
	//
	// For pipes/directives, structural metadata changes (renaming
	// the selector, flipping `pure`, etc.) need to escalate to
	// Tier 1 — but the fingerprint already catches those via
	// `selector` / `standalone` / `inputs` / `outputs` field
	// comparisons. So pipe/directive method-body edits land here
	// safely; pipe metadata edits force Tier 1 elsewhere.
	const kind: AngularEntityKind = params.kind ?? 'component';
	if (kind !== 'component') {
		const moduleText = buildSimpleEntityModule(classNode, className);
		if (!moduleText) {
			return fail(
				'unexpected-error',
				`buildSimpleEntityModule returned null for ${className}`
			);
		}

		return { componentSource: sourceFile, moduleText, ok: true };
	}

	if (inheritsDecoratedClass(classNode)) {
		return fail('inherits-decorated-class');
	}

	const decorator = findComponentDecorator(classNode);
	if (!decorator) return fail('no-component-decorator');

	const decoratorArgs = getDecoratorArgsObject(decorator);
	if (!decoratorArgs) return fail('unsupported-decorator-args');

	const decoratorMeta = readDecoratorMeta(decoratorArgs);
	if (!decoratorMeta.standalone) return fail('not-standalone');

	const componentDir = dirname(componentFilePath);
	let templateText: string;
	let templatePath: string;
	if (decoratorMeta.template !== null) {
		templateText = decoratorMeta.template;
		templatePath = componentFilePath;
	} else if (decoratorMeta.templateUrl) {
		const tplAbs = resolve(componentDir, decoratorMeta.templateUrl);
		if (!existsSync(tplAbs)) {
			return fail('template-resource-not-found', tplAbs);
		}
		templateText = readFileSync(tplAbs, 'utf8');
		templatePath = tplAbs;
	} else {
		return fail('unsupported-decorator-args', 'missing template/templateUrl');
	}

	const { styles, missing: missingStyle } = collectStyles(
		decoratorMeta,
		componentDir
	);
	if (missingStyle) {
		return fail('style-resource-not-found', missingStyle);
	}

	let parsed: ReturnType<typeof compiler.parseTemplate>;
	try {
		parsed = compiler.parseTemplate(templateText, templatePath, {
			preserveWhitespaces: decoratorMeta.preserveWhitespaces
		});
	} catch (err) {
		return fail('template-parse-error', String(err));
	}
	if (parsed.errors && parsed.errors.length > 0) {
		return fail(
			'template-parse-error',
			parsed.errors.map((e) => e.toString()).join('\n')
		);
	}

	const className_ = classNode.name;
	if (!className_) return fail('class-not-found', 'anonymous class');
	const wrappedClass = new compiler.WrappedNodeExpr(className_);

	const { inputs, outputs } = extractInputsAndOutputs(classNode);

	const projectRelPath = relative(projectRoot, componentFilePath).replace(
		/\\/g,
		'/'
	);

	// Structural-fingerprint check — Tier 0 vs Tier 1 gate. The
	// running browser app was either bootstrapped with the bundle's
	// initial structure OR re-bootstrapped after the last Tier 1
	// (which clears the cache). On a Tier 0 surgical, the previous
	// successful surgical's fingerprint is in the cache; we only
	// allow the swap if structure didn't drift since.
	//
	// First call after boot/Tier 1: cache miss → succeed and seed
	// the cache with the just-parsed structure. The bundle that
	// rebuilt last is the source of truth, so its current shape is
	// what's running, so the seeded fingerprint matches reality.
	const fingerprintId = encodeURIComponent(
		`${projectRelPath}@${className}`
	);
	const currentFingerprint = extractFingerprint(
		classNode,
		className,
		decoratorMeta,
		inputs,
		outputs,
		sourceFile,
		componentDir
	);
	const cachedFingerprint = fingerprintCache.get(fingerprintId);
	if (
		cachedFingerprint &&
		!fingerprintsEqual(cachedFingerprint, currentFingerprint)
	) {
		return fail(
			'structural-change',
			`fingerprint changed for ${className}; escalate to Tier 1`
		);
	}

	// Source span — the compiler wants it but the values are only
	// used for diagnostics we never surface, so a zero span pointing
	// at the class node is fine.
	const sourceFileObj = new compiler.ParseSourceFile(
		tsSource,
		componentFilePath
	);
	const zeroLoc = new compiler.ParseLocation(sourceFileObj, 0, 0, 0);
	const typeSourceSpan = new compiler.ParseSourceSpan(zeroLoc, zeroLoc);

	const importsArray: import('@angular/compiler').WrappedNodeExpr<ts.Expression>[] =
		[];
	if (decoratorMeta.importsExpr) {
		for (const el of decoratorMeta.importsExpr.elements) {
			importsArray.push(new compiler.WrappedNodeExpr(el));
		}
	}

	/* `dependencies` accepts raw class refs at runtime: Angular's
	 * scope resolver introspects each entry's `ɵdir` / `ɵcmp` /
	 * `ɵpipe` / `ɵmod` static fields. AOT pre-resolves to the
	 * specific declaration list for tree-shaking; we don't need
	 * that in dev. So `imports: [CommonModule, MyDir]` →
	 * `dependencies: [CommonModule, MyDir]` and runtime handles
	 * the rest. */
	const declarations: unknown[] = importsArray.map((expr) => ({
		kind: 0, // R3TemplateDependencyKind.Directive — runtime ignores
		// the kind and looks at the actual ɵdir/ɵcmp/ɵmod
		// fields of the class.
		type: expr,
		selector: '',
		inputs: [],
		outputs: [],
		exportAs: null,
		isComponent: false
	}));

	const meta = {
		name: className,
		type: { value: wrappedClass, type: wrappedClass },
		typeArgumentCount: 0,
		typeSourceSpan,
		deps: null,
		selector: decoratorMeta.selector,
		queries: [],
		viewQueries: [],
		host: {
			attributes: {},
			listeners: {},
			properties: {},
			specialAttributes: {}
		},
		lifecycle: { usesOnChanges: false },
		inputs,
		outputs,
		usesInheritance: false,
		controlCreate: null,
		exportAs: null,
		providers: null,
		isStandalone: true,
		isSignal: false,
		hostDirectives: null,
		template: {
			nodes: parsed.nodes,
			ngContentSelectors: parsed.ngContentSelectors ?? [],
			preserveWhitespaces: decoratorMeta.preserveWhitespaces
		},
		declarations,
		defer: { mode: 0, blocks: new Map() },
		declarationListEmitMode: 0,
		styles,
		encapsulation: 0,
		animations: null,
		viewProviders: null,
		relativeContextFilePath: projectRelPath,
		i18nUseExternalIds: false,
		changeDetection: null,
		relativeTemplatePath: null,
		hasDirectiveDependencies: importsArray.length > 0
	};

	let compiled: R3CompiledExpression;
	try {
		const pool = new compiler.ConstantPool();
		const bindingParser = compiler.makeBindingParser();
		// The R3ComponentMetadata type is internal-shaped enough that
		// recreating it from public exports trips the compiler — we
		// know the runtime contract. Cast at the boundary.
		compiled = compiler.compileComponentFromMetadata(
			meta as unknown as Parameters<typeof compiler.compileComponentFromMetadata>[0],
			pool,
			bindingParser
		);

		const namespaceDependencies: R3HmrNamespaceDependency[] = [
			{ moduleName: '@angular/core', assignedName: 'ɵhmr0' }
		];

		const callback: DeclareFunctionStmt = compiler.compileHmrUpdateCallback(
			[
				{
					name: 'ɵcmp',
					initializer: compiled.expression,
					statements: compiled.statements ?? []
				}
			],
			pool.statements,
			{
				type: wrappedClass,
				className,
				filePath: projectRelPath,
				namespaceDependencies,
				localDependencies: []
			}
		);

		const namespaceMap = new Map<string, string>();
		for (const dep of namespaceDependencies) {
			namespaceMap.set(dep.moduleName, dep.assignedName);
		}

		// Translate Angular's output AST → TS AST via the vendored
		// translator (see vendor/translator/VENDORED.md). The
		// `HmrImportGenerator` resolves every `ExternalExpr` to a
		// property access on the corresponding `ɵhmr<i>` parameter,
		// so the resulting TS function has no top-level imports —
		// just `export default function ${name}(...) { ... }`.
		const importGenerator = createHmrImportGenerator(namespaceMap);
		const tsFunctionDecl = translateStatement(
			sourceFile,
			callback,
			importGenerator
		) as ts.FunctionDeclaration;

		// Add `export default` modifiers — `compileHmrUpdateCallback`
		// emits a plain function declaration (since output AST has no
		// notion of ESM exports). Mirrors what compiler-cli's
		// `getHmrUpdateDeclaration` does after its translateStatement
		// call.
		const exportedDecl = ts.factory.updateFunctionDeclaration(
			tsFunctionDecl,
			[
				ts.factory.createToken(ts.SyntaxKind.ExportKeyword),
				ts.factory.createToken(ts.SyntaxKind.DefaultKeyword)
			],
			tsFunctionDecl.asteriskToken,
			tsFunctionDecl.name,
			tsFunctionDecl.typeParameters,
			tsFunctionDecl.parameters,
			tsFunctionDecl.type,
			tsFunctionDecl.body
		);

		const printer = ts.createPrinter({
			newLine: ts.NewLineKind.LineFeed,
			removeComments: false
		});
		const tsSourceText = printer.printNode(
			ts.EmitHint.Unspecified,
			exportedDecl,
			sourceFile
		);

		// Pass through `transpileModule` to strip any leftover TS
		// syntax (type annotations, parameter property modifiers) and
		// produce ES2022. Same pattern as compiler-cli's
		// `NgCompiler.emitHmrUpdateModule`.
		const transpiled = ts.transpileModule(tsSourceText, {
			compilerOptions: {
				module: ts.ModuleKind.ES2022,
				target: ts.ScriptTarget.ES2022
			},
			fileName: componentFilePath,
			reportDiagnostics: false
		}).outputText;

		// Inject the prototype-patch block at the start of the
		// function body so existing instances' methods are swapped
		// before the `ɵcmp` update triggers view re-renders. Without
		// this, edits to method bodies (e.g. `count++` → `count += 2`
		// inside `increment()`) silently no-op — see
		// `buildFreshClassMethodsBlock` for the why. We inject AFTER
		// transpile because the printed TS source still has type
		// annotations on parameters (`(Cls: any, ɵɵns: any)`) and we
		// want a stable JS signature to anchor against.
		const methodsBlock = buildFreshClassMethodsBlock(
			classNode,
			className
		);
		let moduleText = transpiled;
		if (methodsBlock) {
			const fnOpening = `function ${className}_UpdateMetadata(${className}, ɵɵnamespaces) {`;
			const idx = moduleText.indexOf(fnOpening);
			if (idx >= 0) {
				const insertAt = idx + fnOpening.length;
				moduleText =
					moduleText.slice(0, insertAt) +
					'\n' +
					methodsBlock +
					'\n' +
					moduleText.slice(insertAt);
			}
		}

		// Surgical succeeded — seed/refresh the fingerprint cache
		// with the just-applied structure. Next surgical compares
		// against this baseline.
		fingerprintCache.set(fingerprintId, currentFingerprint);

		return { ok: true, moduleText, componentSource: sourceFile };
	} catch (err) {
		return fail('unexpected-error', String(err));
	}
};
