/* Surgical-HMR fast path. Replaces the ngtsc/`performCompilation`
 * pipeline (which runs ~1-3s incremental, dominated by program-wide
 * TCB synthesis + analysis) with a single-file metadata extractor +
 * `compileComponentFromMetadata` IR pass. Median measured at ~4ms,
 * ~320× faster than the AOT incremental path.
 *
 * Architectural premise: Angular's compile bundles template
 * type-checking with template compilation because templates aren't
 * TypeScript and the TCB has to live in the same TS program. For HMR
 * specifically, the editor + a separate `tsc` daemon already cover
 * type-checking — paying for it again at every keystroke is a tax
 * we're choosing not to.
 *
 * Coverage and the small set of cases that escalate to Tier 1b
 * rebootstrap (heritage from a decorated parent class, exotic
 * decorator-arg shapes) are documented in
 * `ABSOLUTEJS_ANGULAR_HMR.md`. */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
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
 *   - `topLevelImports`: sorted list of every top-level binding the
 *     source file imports (named, default, namespace). Tier 0
 *     surgical updates resolve user-source identifiers via
 *     `${ClassName}.__abs_deps`, which `hmrInjectionPlugin`
 *     populates at initial-bundle / per-request-transform time.
 *     The live class on the page carries whatever `__abs_deps` was
 *     set when its module last loaded, which means a Tier 0 cycle
 *     that adds a brand-new top-level import would reference a
 *     binding that isn't on the live `__abs_deps`. Capturing the
 *     import set in the fingerprint forces those edits to Tier 1a
 *     remount, which fetches a freshly-evaluated class whose
 *     `__abs_deps` reflects the new source. Without this, the new
 *     import would be `undefined` until the next page reload.
 *   - `propertyFieldNames`: sorted list of class property
 *     declaration names (regardless of decorator, type, or
 *     initializer). Tier 0 surgical updates only swap method
 *     bodies onto the prototype; they do NOT re-run field
 *     initializers on existing instances. Adding a new
 *     non-decorated field referenced by a method body would leave
 *     existing instances missing the field, and the new method
 *     emit would access `this.<newField>` as `undefined`.
 *     Capturing the field set forces Tier 1a remount on additions
 *     and removals so existing instances are recreated with the
 *     new field set initialized. Initializer VALUE changes (e.g.,
 *     `count = 0` → `count = 5`) leave the name set unchanged and
 *     stay on Tier 0, preserving instance state — the user
 *     wouldn't expect saving a typo fix in a field default to
 *     reset their live counter.
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
	topLevelImports: string[];
	/* Sorted list of class property declaration names. Catches
	 * additions and removals of non-decorated, non-arrow fields
	 * that the existing prototype-patch and other fingerprint
	 * dimensions miss. */
	propertyFieldNames: string[];
	/* `ViewEncapsulation` numeric value. Switching between
	 * Emulated / None / ShadowDom changes how the component's
	 * styles are scoped at the host level; existing instances'
	 * applied styles can't be retroactively re-scoped, so a
	 * change here forces Tier 1a remount. */
	encapsulation: number;
	/* `ChangeDetectionStrategy` numeric value or `null`. Switching
	 * between OnPush and Default changes the LView flags that
	 * govern dirty-checking; the existing LViews carry the old
	 * flags, so a change forces Tier 1a remount. */
	changeDetection: number | null;
	/* Hash of the `@Component({ imports: [...] })` array text.
	 * Adding/removing a directive or pipe to the imports list
	 * changes the directiveDefs/pipeDefs the template can match;
	 * the existing LView's directive matching ran against the
	 * pre-edit list, so a change forces Tier 1b rebootstrap (a
	 * Tier 1a remount can't re-run directive matching against
	 * existing host elements). Empty/missing array → empty hash.
	 * Order-sensitive (reordering changes runtime resolution
	 * order). */
	importsArraySig: string;
	/* Hash of the `@Component({ hostDirectives: [...] })` array
	 * text. Each entry there is wired into the host element at
	 * `ɵɵdefineComponent` time and instantiated alongside the
	 * component at element-creation time; modifying the list
	 * post-creation cannot retroactively attach or remove host
	 * directive instances. Forces Tier 1b rebootstrap. */
	hostDirectivesSig: string;
	/* Hash of the `@Component({ animations: [...] })` array text.
	 * Animations triggers and their state/transition contents are
	 * wired into the component's view at definition time. Editing
	 * trigger bodies isn't covered by `topLevelImports` (the
	 * trigger / state / style symbols are already imported), so
	 * we fingerprint the array text directly. Forces Tier 1a
	 * remount on change. */
	animationsArraySig: string;
	/* Hash of the `@Component({ providers: [...] })` array text.
	 * Tracking just `hasProviders: boolean` misses edits inside
	 * the array — swapping a `useFactory`, changing a `useValue`,
	 * or reordering provider entries reshapes the DI tree, but
	 * existing instances hold the OLD factory's resolved value.
	 * Forces Tier 1b rebootstrap on change. */
	providersArraySig: string;
	/* Hash of the `@Component({ viewProviders: [...] })` array
	 * text. Same rationale as `providersArraySig` — view-scoped
	 * providers also reshape the element-injector tree at
	 * creation time. Forces Tier 1b rebootstrap. */
	viewProvidersArraySig: string;
	/* Hash of the `@Component({ inputs: [...] })` decorator-array
	 * form. The field-level `inputs` fingerprint dimension only
	 * captures `@Input()` decorators on properties; the legacy
	 * `inputs: ['name', 'other: alias']` array form on the
	 * decorator itself is a separate metadata source. Renaming
	 * an alias or adding/removing entries shifts the public
	 * binding names but doesn't touch any field. Forces Tier 1a
	 * remount on change. */
	decoratorInputsArraySig: string;
	/* Hash of the `@Component({ outputs: [...] })` decorator-array
	 * form. Same rationale as `decoratorInputsArraySig`. */
	decoratorOutputsArraySig: string;
	/* Hash of the `@Component({ host: { ... } })` object text.
	 * Host bindings (`(click)`, `[class.active]`, `[attr.role]`)
	 * are wired into the host element at LView-creation time;
	 * Tier 0 ɵcmp updates don't (de)attach listeners or re-bind
	 * properties against the existing host element. Forces
	 * Tier 1a remount on change so the host gets a fresh wire-
	 * up. */
	hostBindingsSig: string;
	/* Hash of module-level framework-special exports the
	 * component file may declare alongside its `@Component`
	 * class — `export const providers = [...]` (bootstrap-level
	 * providers consumed by `bootstrapApplication`),
	 * `export const routes = [...]` (router config). Edits to
	 * these reshape the DI / router tree at app-bootstrap level,
	 * so existing instances hold the OLD provider tree's
	 * resolved values. Captured separately from the decorator
	 * fingerprint because they live outside the decorator. Forces
	 * Tier 1b rebootstrap on change. */
	pageExportsSig: string;
	/* Hash of the `@Component({ schemas: [...] })` array text.
	 * Schemas (`CUSTOM_ELEMENTS_SCHEMA`, `NO_ERRORS_SCHEMA`)
	 * affect which unknown elements / attributes the template
	 * compiler accepts at view-instantiation time — they're
	 * baked into the component's scope context, so toggling
	 * them on/off changes which elements live templates
	 * accept. Forces Tier 1a remount on change so the new
	 * scope context is wired. */
	schemasSig: string;
};

export type FastHmrSuccess = {
	ok: true;
	moduleText: string;
	componentSource: ts.SourceFile;
	/* True when the component's structural fingerprint changed since
	 * the last successful compile — caller should pick the Tier 1a
	 * remount path (per-component destroy + recreate) instead of the
	 * Tier 0 surgical swap. The compiled module is still valid in
	 * either case; the flag is purely a tier hint. */
	fingerprintChanged: boolean;
	/* True when the fingerprint dimension that changed is one a
	 * Tier 1a remount can't faithfully apply — the existing host
	 * elements would still carry the pre-edit directive matches.
	 * Forces the dispatcher to escalate to Tier 1b (full
	 * rebootstrap). Currently flagged on:
	 *   - `@Component({ imports: [...] })` array changes —
	 *     directive matching runs at element-creation time and a
	 *     remounted instance against the same hostElement won't
	 *     re-match newly-listed directives on existing children.
	 *   - `@Component({ hostDirectives: [...] })` changes — host
	 *     directives are wired into the host TNode at definition
	 *     time and can't be retroactively attached or removed.  */
	rebootstrapRequired: boolean;
};

export type FastHmrFailure = {
	ok: false;
	reason: FastHmrFallbackReason;
	detail?: string;
	/* User-fixable failures (template-parse-error, template/style-resource-not-found,
	 * unexpected parser errors) carry these so the dispatcher can render an
	 * inline error overlay instead of silently rebootstrapping. Other failure
	 * reasons (file-not-found, structural-change) leave them undefined. */
	file?: string;
	line?: number;
	column?: number;
	lineText?: string;
};

export type FastHmrResult = FastHmrSuccess | FastHmrFailure;

type FailLocation = {
	file?: string;
	line?: number;
	column?: number;
	lineText?: string;
};

const fail = (
	reason: FastHmrFallbackReason,
	detail?: string,
	location?: FailLocation
): FastHmrFailure => ({
	ok: false,
	reason,
	detail,
	...(location ?? {})
});

/* ─── Fingerprint cache ──────────────────────────────────────── */

/* Module-scoped cache. Key is the encoded HMR id
 * (`encodeURIComponent('<projectRel>@<className>')`) — same key
 * the `/@ng/component` endpoint uses. Map persists for the
 * lifetime of the dev server; cleared after a Tier 1 re-bootstrap
 * (the bundle is rebuilt with the new structure as the new
 * baseline). */
const fingerprintCache = new Map<string, ComponentFingerprint>();

/* Pending-module cache: keyed by encoded HMR id, holds the most
 * recent successful surgical-module text. Populated by `tryFastHmr`
 * on successful compile, drained by the `/@ng/component` endpoint
 * the next time the browser fetches that id.
 *
 * Why: file-watch + dispatcher already calls `tryFastHmr` to decide
 * the tier (Tier 0 vs 1a). That call produced the same `moduleText`
 * the endpoint will need ~10–500ms later when the browser fetches.
 * Without caching, the endpoint re-runs the full TS-parse → IR-build
 * → translate → transpile pipeline a SECOND time, doubling perceived
 * server latency on every edit. With caching, the endpoint is a near-
 * instant lookup.
 *
 * Cache eviction: drained on read (single-use). If the file changes
 * again before fetch, the dispatcher overwrites with the fresh
 * compile. If the browser somehow fetches twice for the same id, the
 * second fetch falls through to a fresh compile — correct, just slow. */
const pendingModuleCache = new Map<string, string>();

export const takePendingModule = (id: string): string | undefined => {
	const cached = pendingModuleCache.get(id);
	if (cached !== undefined) pendingModuleCache.delete(id);
	return cached;
};

const setPendingModule = (id: string, moduleText: string): void => {
	pendingModuleCache.set(id, moduleText);
};

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
	if (!arraysEqual(a.topLevelImports, b.topLevelImports)) return false;
	if (!arraysEqual(a.propertyFieldNames, b.propertyFieldNames)) return false;
	if (a.encapsulation !== b.encapsulation) return false;
	if (a.changeDetection !== b.changeDetection) return false;
	if (a.importsArraySig !== b.importsArraySig) return false;
	if (a.hostDirectivesSig !== b.hostDirectivesSig) return false;
	if (a.animationsArraySig !== b.animationsArraySig) return false;
	if (a.providersArraySig !== b.providersArraySig) return false;
	if (a.viewProvidersArraySig !== b.viewProvidersArraySig) return false;
	if (a.decoratorInputsArraySig !== b.decoratorInputsArraySig) return false;
	if (a.decoratorOutputsArraySig !== b.decoratorOutputsArraySig)
		return false;
	if (a.hostBindingsSig !== b.hostBindingsSig) return false;
	if (a.pageExportsSig !== b.pageExportsSig) return false;
	if (a.schemasSig !== b.schemasSig) return false;

	return true;
};

export const recordFingerprint = (
	id: string,
	fp: ComponentFingerprint
): void => {
	fingerprintCache.set(id, fp);
};

/* Prime the fingerprint cache for one component file using the
 * pre-edit (initial-bundle) source. Called after the initial
 * `compileAngular` finishes so that the FIRST user edit has a
 * baseline to compare against — without priming, the first
 * edit always reports `cachedFingerprint === undefined` and
 * skips both `fingerprintChanged` and `rebootstrapRequired`
 * detection, so a user's first imports/hostDirectives/providers
 * edit silently runs through Tier 0 instead of escalating to
 * Tier 1b.
 *
 * The function deliberately mirrors the early phases of
 * `tryFastHmr`: parse the file, find the class node by name,
 * read the decorator metadata, extract the fingerprint, store
 * it. We DON'T run the IR compile (no `compileComponentFromMetadata`
 * call) — fingerprint extraction alone is enough for the
 * comparison path, and skipping the IR keeps priming cheap
 * (~1-3 ms per file). On parse error / missing decorator we
 * silently skip; the cache will populate naturally on the
 * first successful HMR cycle. */
export const primeComponentFingerprint = async (
	componentFilePath: string
): Promise<void> => {
	let source: string;
	try {
		source = await (await import('node:fs/promises')).readFile(
			componentFilePath,
			'utf8'
		);
	} catch {
		return;
	}
	let sourceFile: ts.SourceFile;
	try {
		sourceFile = ts.createSourceFile(
			componentFilePath,
			source,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS
		);
	} catch {
		return;
	}

	for (const stmt of sourceFile.statements) {
		if (!ts.isClassDeclaration(stmt)) continue;
		const className = stmt.name?.text;
		if (!className) continue;

		const decorators = ts.getDecorators(stmt) ?? [];
		const decoratorName = (() => {
			for (const d of decorators) {
				if (!ts.isCallExpression(d.expression)) continue;
				const expr = d.expression.expression;
				if (!ts.isIdentifier(expr)) continue;
				if (
					expr.text === 'Component' ||
					expr.text === 'Directive' ||
					expr.text === 'Pipe' ||
					expr.text === 'Injectable'
				) {
					return expr.text;
				}
			}
			return null;
		})();
		if (!decoratorName) continue;

		const projectRel = relative(process.cwd(), componentFilePath).replace(
			/\\/g,
			'/'
		);
		const id = encodeURIComponent(`${projectRel}@${className}`);

		if (decoratorName === 'Component') {
			const componentDecorator = decorators.find((d) => {
				if (!ts.isCallExpression(d.expression)) return false;
				const expr = d.expression.expression;
				return ts.isIdentifier(expr) && expr.text === 'Component';
			});
			if (!componentDecorator) continue;
			const decoratorCall =
				componentDecorator.expression as ts.CallExpression;
			const args = decoratorCall.arguments[0];
			if (!args || !ts.isObjectLiteralExpression(args)) continue;

			const decoratorMeta = readDecoratorMeta(args);
			const { inputs, outputs } = extractInputsAndOutputs(stmt, null);
			const componentDir = dirname(componentFilePath);
			const fingerprint = extractFingerprint(
				stmt,
				className,
				decoratorMeta,
				inputs,
				outputs,
				sourceFile,
				componentDir
			);
			fingerprintCache.set(id, fingerprint);
		} else {
			// `@Directive`, `@Pipe`, `@Injectable` — populate the
			// entity-fingerprint cache so the FIRST edit detects
			// decorator-arg / structural-surface changes (selector
			// rename, pipe-name rename, providedIn switch, etc.).
			// Without priming, the first edit's
			// `cachedEntityFingerprint === undefined` check skips
			// the comparison and runs Tier 0 against the renamed
			// entity, leaving live templates pointing at the OLD
			// selector/name.
			try {
				const entityFingerprint = extractEntityFingerprint(
					stmt,
					className,
					sourceFile
				);
				entityFingerprintCache.set(id, entityFingerprint);
			} catch {
				// Best-effort priming.
			}
		}
	}
};

/* Clear all cached fingerprints. Called after a Tier 1
 * re-bootstrap completes — at that point the running app's
 * structure matches the new bundle, and the next surgical edit
 * should establish fresh baselines from the new source. */
export const invalidateFingerprintCache = (): void => {
	fingerprintCache.clear();
	entityFingerprintCache.clear();
};

/* Per-entity fingerprint cache for non-component Angular classes
 * (`@Pipe`, `@Directive`, `@Injectable`). Captures decorator-arg
 * text plus the same structural-surface dimensions the component
 * fingerprint uses (constructor signature, top-level imports,
 * member decorators, field set, arrow-field hashes). Mismatch
 * between cycles forces Tier 1b rebootstrap because:
 *   - `@Pipe.name` changes break template binding lookups (live
 *     templates reference the pipe by old name)
 *   - `@Directive.selector` changes break template binding
 *     (live host elements were matched under the old selector)
 *   - `@Injectable.providedIn` / `useFactory` / `useClass` changes
 *     reshape the DI tree (existing singletons hold the old
 *     factory's instance) */
type EntityFingerprint = {
	className: string;
	decoratorArgsText: string;
	ctorParamTypes: string[];
	topLevelImports: string[];
	memberDecoratorSig: string[];
	arrowFieldSig: string[];
	propertyFieldNames: string[];
};

const entityFingerprintCache = new Map<string, EntityFingerprint>();

const entityFingerprintsEqual = (
	a: EntityFingerprint,
	b: EntityFingerprint
): boolean => {
	if (a.className !== b.className) return false;
	if (a.decoratorArgsText !== b.decoratorArgsText) return false;
	if (!arraysEqual(a.ctorParamTypes, b.ctorParamTypes)) return false;
	if (!arraysEqual(a.topLevelImports, b.topLevelImports)) return false;
	if (!arraysEqual(a.memberDecoratorSig, b.memberDecoratorSig)) return false;
	if (!arraysEqual(a.arrowFieldSig, b.arrowFieldSig)) return false;
	if (!arraysEqual(a.propertyFieldNames, b.propertyFieldNames)) return false;
	return true;
};

const ENTITY_DECORATOR_NAMES = new Set(['Pipe', 'Directive', 'Injectable']);

const findEntityDecorator = (cls: ts.ClassDeclaration): ts.Decorator | null => {
	for (const dec of ts.getDecorators(cls) ?? []) {
		const expr = dec.expression;
		if (!ts.isCallExpression(expr)) continue;
		if (!ts.isIdentifier(expr.expression)) continue;
		if (ENTITY_DECORATOR_NAMES.has(expr.expression.text)) return dec;
	}
	return null;
};

const extractEntityFingerprint = (
	cls: ts.ClassDeclaration,
	className: string,
	sourceFile: ts.SourceFile
): EntityFingerprint => {
	const decorator = findEntityDecorator(cls);
	let decoratorArgsText = '';
	if (decorator !== null) {
		const expr = decorator.expression as ts.CallExpression;
		const arg = expr.arguments[0];
		if (arg !== undefined) {
			decoratorArgsText = arg.getText().replace(/\s+/g, ' ').trim();
		}
	}

	const ctorParamTypes: string[] = [];
	for (const member of cls.members) {
		if (!ts.isConstructorDeclaration(member)) continue;
		for (const param of member.parameters) {
			const typeText = param.type ? param.type.getText() : '';
			const decorators = ts.getDecorators(param) ?? [];
			const decoratorSig =
				decorators.length === 0
					? ''
					: decorators
							.map((d) => {
								const e = d.expression;
								if (
									ts.isCallExpression(e) &&
									ts.isIdentifier(e.expression)
								) {
									const args = e.arguments
										.map((a) => a.getText())
										.join(',');
									return `@${e.expression.text}(${args})`;
								}
								if (ts.isIdentifier(e)) return `@${e.text}`;
								return '@<unknown>';
							})
							.join('');
			ctorParamTypes.push(`${typeText}${decoratorSig}`);
		}
		break;
	}

	return {
		className,
		decoratorArgsText,
		ctorParamTypes,
		topLevelImports: extractTopLevelImports(sourceFile),
		memberDecoratorSig: extractMemberDecoratorSig(cls),
		arrowFieldSig: extractArrowFieldSig(cls),
		propertyFieldNames: extractPropertyFieldNames(cls)
	};
};

/* ─── TS AST helpers ─────────────────────────────────────────── */

const findClassDeclaration = (
	sourceFile: ts.SourceFile,
	className: string
): ts.ClassDeclaration | null => {
	let found: ts.ClassDeclaration | null = null;
	const walk = (node: ts.Node) => {
		if (found) return;
		if (ts.isClassDeclaration(node) && node.name?.text === className) {
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

/* Most `extends` clauses in modern Angular code are non-decorated
 * utility base classes (`BaseFormComponent`, `Disposable`, etc.).
 * Those merge into the child via JavaScript's prototype chain — no
 * Angular metadata to combine, the child's own `R3ComponentMetadata`
 * is sufficient.
 *
 * The case we DO need to bail on is `class Foo extends Bar` where
 * `Bar` itself has `@Component` / `@Directive` / `@Pipe`. ngc walks
 * the heritage chain and merges their template / inputs / outputs /
 * host / queries up. Reproducing that merge is meaningful work
 * (precedence rules vary per field) and uncommon enough to defer —
 * `usesInheritance: true` + ngc-equivalent merge is a future
 * extension if real codebases hit it.
 *
 * Resolves the parent class identifier across files: looks up the
 * heritage clause's identifier in the source file's imports, resolves
 * the import to a `.ts` source, parses it, checks whether the
 * matching class declaration has a `@Component` / `@Directive` /
 * `@Pipe` / `@Injectable` decorator. Same-file parents are also
 * checked (no resolution needed). */
const isAngularDecoratorIdentifier = (name: string): boolean =>
	name === 'Component' ||
	name === 'Directive' ||
	name === 'Pipe' ||
	name === 'Injectable';

const classHasAngularDecorator = (cls: ts.ClassDeclaration): boolean => {
	for (const dec of ts.getDecorators(cls) ?? []) {
		const expr = dec.expression;
		if (
			ts.isCallExpression(expr) &&
			ts.isIdentifier(expr.expression) &&
			isAngularDecoratorIdentifier(expr.expression.text)
		) {
			return true;
		}
	}
	return false;
};

const findClassInSourceFile = (
	sf: ts.SourceFile,
	className: string
): ts.ClassDeclaration | null => {
	for (const stmt of sf.statements) {
		if (ts.isClassDeclaration(stmt) && stmt.name?.text === className) {
			return stmt;
		}
	}
	return null;
};

const parentHasAngularDecoratorAcrossFiles = (
	parentClassName: string,
	sourceFile: ts.SourceFile,
	componentDir: string,
	projectRoot: string
): boolean => {
	const sameFile = findClassInSourceFile(sourceFile, parentClassName);
	if (sameFile) return classHasAngularDecorator(sameFile);

	// Cross-file: walk imports to find where the parent comes from.
	for (const stmt of sourceFile.statements) {
		if (!ts.isImportDeclaration(stmt)) continue;
		if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
		const clause = stmt.importClause;
		if (!clause || clause.isTypeOnly) continue;
		const named = clause.namedBindings;
		if (!named || !ts.isNamedImports(named)) continue;
		const found = named.elements.find(
			(el) => el.name.text === parentClassName
		);
		if (!found) continue;
		const spec = stmt.moduleSpecifier.text;
		// Only resolve project-local imports — node_modules parents
		// (Angular CDK base classes, library mixins) are decorated
		// or not by their own published code, but their metadata is
		// in the shipped `.d.ts`'s `ɵdir`/`ɵcmp` declaration. We
		// already know how to read those (see
		// `getChildComponentInfoFromDts` for child-component metadata
		// extraction). For inheritance, the conservative call is
		// "library parent → bail" since we don't yet merge — same
		// outcome as before this commit. Local parents we resolve.
		if (!spec.startsWith('.') && !spec.startsWith('/')) {
			// Bare specifier — assume it could be decorated, bail.
			return true;
		}
		const base = resolve(componentDir, spec);
		const candidates = [
			`${base}.ts`,
			`${base}.tsx`,
			`${base}/index.ts`,
			`${base}/index.tsx`
		];
		for (const candidate of candidates) {
			if (!existsSync(candidate)) continue;
			let content: string;
			try {
				content = readFileSync(candidate, 'utf-8');
			} catch {
				continue;
			}
			const parentSf = ts.createSourceFile(
				candidate,
				content,
				ts.ScriptTarget.Latest,
				true
			);
			const parentCls = findClassInSourceFile(parentSf, parentClassName);
			if (!parentCls) continue;
			return classHasAngularDecorator(parentCls);
		}
		// Import found but file unreadable — conservative bail.
		return true;
	}
	// No matching import — parent is either local-but-undeclared or
	// global. Conservative bail.
	return true;
};

const inheritsDecoratedClass = (
	cls: ts.ClassDeclaration,
	sourceFile: ts.SourceFile,
	componentDir: string,
	projectRoot: string
): boolean => {
	const heritage = cls.heritageClauses ?? [];
	for (const clause of heritage) {
		if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
		for (const typeNode of clause.types) {
			const expr = typeNode.expression;
			if (!ts.isIdentifier(expr)) {
				// Complex heritage (computed property access, etc.) —
				// rare enough to bail on.
				return true;
			}
			if (
				parentHasAngularDecoratorAcrossFiles(
					expr.text,
					sourceFile,
					componentDir,
					projectRoot
				)
			) {
				return true;
			}
		}
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
	/* The raw `hostDirectives: [...]` array node, kept for
	 * fingerprint hashing. Each entry there is wired into the
	 * host element at definition time and instantiated alongside
	 * the component at element-creation time; modifying the list
	 * post-creation cannot retroactively attach or remove host
	 * directive instances, so `hostDirectivesSig` changes force
	 * Tier 1b rebootstrap. */
	hostDirectivesExpr: ts.ArrayLiteralExpression | null;
	/* The raw `animations: [...]` array node. Animations triggers
	 * are wired into the component's view at definition time, so
	 * editing trigger contents needs Tier 1a remount. */
	animationsExpr: ts.ArrayLiteralExpression | null;
	/* The raw `providers: [...]` array node. Tracking just
	 * `hasProviders: boolean` misses edits inside the array —
	 * swapping a `useFactory`, changing a `useValue`, or
	 * reordering provider entries reshapes the DI tree, but
	 * existing instances hold the OLD factory's resolved value
	 * (DI happens at instance-creation time). Forces Tier 1b
	 * rebootstrap on change. */
	providersExpr: ts.ArrayLiteralExpression | null;
	/* The raw `viewProviders: [...]` array node. Same rationale
	 * as `providersExpr` — view-scoped providers also reshape the
	 * element-injector tree at creation time. */
	viewProvidersExpr: ts.ArrayLiteralExpression | null;
	/* The raw `inputs: [...]` array node from the `@Component`
	 * decorator. This is the legacy decorator-array form
	 * (`inputs: ['flag', 'other: alias']`) — separate from
	 * field-level `@Input()` decorators which the existing
	 * `inputs` fingerprint covers. Renaming an alias or
	 * adding/removing entries here changes the public binding
	 * names, but the field-level extractor doesn't see this list,
	 * so we hash the array text directly. */
	inputsArrayExpr: ts.ArrayLiteralExpression | null;
	/* The raw `outputs: [...]` array node — same rationale as
	 * `inputsArrayExpr`. */
	outputsArrayExpr: ts.ArrayLiteralExpression | null;
	/* The raw `host: { ... }` object node. Host bindings (event
	 * listeners and property/attribute bindings on the host
	 * element) are wired up at LView creation time. Tier 0
	 * surgical updates rebuild `ɵcmp` but don't (de)attach
	 * listeners against the existing host element, so
	 * adding/removing/swapping a `(click)` listener silently
	 * leaves the OLD listener attached and the NEW one never
	 * registered. Hashed via `hostBindingsSig`; changes force
	 * Tier 1a remount so the host element gets a fresh
	 * listener wire-up. */
	hostExpr: ts.ObjectLiteralExpression | null;
	/* The raw `schemas: [...]` array node. Schemas
	 * (`CUSTOM_ELEMENTS_SCHEMA`, `NO_ERRORS_SCHEMA`) affect
	 * which unknown elements/attributes the template compiler
	 * accepts at view-instantiation time. Toggling them
	 * silently keeps the OLD schema rules baked into existing
	 * LViews. */
	schemasExpr: ts.ArrayLiteralExpression | null;
	hasProviders: boolean;
	hasViewProviders: boolean;
	/* `ViewEncapsulation` numeric value (Emulated=0, None=2,
	 * ShadowDom=3, ExperimentalIsolatedShadowDom=4). Defaults to
	 * Emulated when the decorator doesn't specify or uses a form
	 * the resolver doesn't recognize. */
	encapsulation: number;
	/* `ChangeDetectionStrategy` numeric value (OnPush=0,
	 * Default=1). `null` when not specified, which Angular treats
	 * as Default. */
	changeDetection: number | null;
};

/* Extract `R3DirectiveMetadata.controlCreate` from a class. Mirrors
 * `extractControlDirectiveDefinition` in `@angular/compiler-cli`:
 * find a non-static method whose name is the unicode-prefixed
 * `ɵngControlCreate` (used by `@angular/forms`-style signal-based
 * form-control directives). If absent, return `null`. If present
 * but the first parameter's type isn't a generic reference with a
 * single string-literal type argument, return
 * `{ passThroughInput: null }`. Otherwise the type-argument's
 * string-literal value goes into `passThroughInput`, which the
 * runtime uses to recognize matching pass-through input bindings
 * on co-located directives. */
const CONTROL_CREATE_METHOD_NAME = 'ɵngControlCreate';

const extractControlCreate = (
	cls: ts.ClassDeclaration
): { passThroughInput: string | null } | null => {
	for (const member of cls.members) {
		if (!ts.isMethodDeclaration(member)) continue;
		if (
			member.modifiers?.some(
				(m) => m.kind === ts.SyntaxKind.StaticKeyword
			)
		)
			continue;
		const name = member.name;
		if (name === undefined) continue;
		const nameText = ts.isIdentifier(name) ? name.text : name.getText();
		if (nameText !== CONTROL_CREATE_METHOD_NAME) continue;
		const firstParam = member.parameters[0];
		if (
			firstParam === undefined ||
			firstParam.type === undefined ||
			!ts.isTypeReferenceNode(firstParam.type)
		) {
			return { passThroughInput: null };
		}
		const typeArgs = firstParam.type.typeArguments;
		if (typeArgs === undefined || typeArgs.length !== 1) {
			return { passThroughInput: null };
		}
		const arg = typeArgs[0];
		if (
			arg === undefined ||
			!ts.isLiteralTypeNode(arg) ||
			!ts.isStringLiteral(arg.literal)
		) {
			return { passThroughInput: null };
		}
		return { passThroughInput: arg.literal.text };
	}
	return null;
};

/* Resolve a `<EnumName>.<MemberName>` property access expression
 * (the only form the @Component decorator accepts in practice for
 * `encapsulation` and `changeDetection`) to the corresponding
 * numeric enum value. Returns `null` for any other expression
 * shape; the caller decides the fallback. */
const resolveEnumPropertyAccess = (
	expr: ts.Expression,
	enumName: string,
	values: Readonly<Record<string, number>>
): number | null => {
	if (!ts.isPropertyAccessExpression(expr)) return null;
	if (!ts.isIdentifier(expr.expression)) return null;
	if (expr.expression.text !== enumName) return null;
	const v = values[expr.name.text];
	return typeof v === 'number' ? v : null;
};

const VIEW_ENCAPSULATION_VALUES: Readonly<Record<string, number>> = {
	Emulated: 0,
	ExperimentalIsolatedShadowDom: 4,
	None: 2,
	ShadowDom: 3
};

const CHANGE_DETECTION_VALUES: Readonly<Record<string, number>> = {
	Default: 1,
	Eager: 1,
	OnPush: 0
};

const readDecoratorMeta = (
	args: ts.ObjectLiteralExpression,
	projectDefaults: ProjectAngularCompilerOptions = {}
): ComponentDecoratorMeta => {
	const styleUrlsExpr = getProperty(args, 'styleUrls');
	const stylesExpr = getProperty(args, 'styles');
	const importsExpr = getProperty(args, 'imports');
	const hostDirectivesExpr = getProperty(args, 'hostDirectives');
	const animationsExpr = getProperty(args, 'animations');
	const providersExpr = getProperty(args, 'providers');
	const viewProvidersExpr = getProperty(args, 'viewProviders');
	const inputsArrayExpr = getProperty(args, 'inputs');
	const outputsArrayExpr = getProperty(args, 'outputs');
	const hostExpr = getProperty(args, 'host');
	const schemasExpr = getProperty(args, 'schemas');

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

	const encapsulationExpr = getProperty(args, 'encapsulation');
	const encapsulation = encapsulationExpr
		? (resolveEnumPropertyAccess(
				encapsulationExpr,
				'ViewEncapsulation',
				VIEW_ENCAPSULATION_VALUES
			) ?? 0)
		: 0;

	const changeDetectionExpr = getProperty(args, 'changeDetection');
	const changeDetection = changeDetectionExpr
		? resolveEnumPropertyAccess(
				changeDetectionExpr,
				'ChangeDetectionStrategy',
				CHANGE_DETECTION_VALUES
			)
		: null;

	return {
		changeDetection,
		encapsulation,
		hasProviders: getProperty(args, 'providers') !== null,
		hasViewProviders: getProperty(args, 'viewProviders') !== null,
		importsExpr:
			importsExpr && ts.isArrayLiteralExpression(importsExpr)
				? importsExpr
				: null,
		hostDirectivesExpr:
			hostDirectivesExpr &&
			ts.isArrayLiteralExpression(hostDirectivesExpr)
				? hostDirectivesExpr
				: null,
		animationsExpr:
			animationsExpr && ts.isArrayLiteralExpression(animationsExpr)
				? animationsExpr
				: null,
		providersExpr:
			providersExpr && ts.isArrayLiteralExpression(providersExpr)
				? providersExpr
				: null,
		viewProvidersExpr:
			viewProvidersExpr &&
			ts.isArrayLiteralExpression(viewProvidersExpr)
				? viewProvidersExpr
				: null,
		inputsArrayExpr:
			inputsArrayExpr &&
			ts.isArrayLiteralExpression(inputsArrayExpr)
				? inputsArrayExpr
				: null,
		outputsArrayExpr:
			outputsArrayExpr &&
			ts.isArrayLiteralExpression(outputsArrayExpr)
				? outputsArrayExpr
				: null,
		hostExpr:
			hostExpr && ts.isObjectLiteralExpression(hostExpr)
				? hostExpr
				: null,
		schemasExpr:
			schemasExpr && ts.isArrayLiteralExpression(schemasExpr)
				? schemasExpr
				: null,
		preserveWhitespaces:
			getBooleanProperty(args, 'preserveWhitespaces') ??
			projectDefaults.preserveWhitespaces ??
			false,
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
	prop: ts.PropertyDeclaration,
	compiler: typeof import('@angular/compiler') | null
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
		let transformFunction: import('@angular/compiler').Expression | null =
			null;

		const arg = expr.arguments[0];
		if (arg) {
			if (ts.isStringLiteral(arg)) {
				// @Input('alias') name — legacy alias form
				bindingPropertyName = arg.text;
			} else if (ts.isObjectLiteralExpression(arg)) {
				const aliasNode = getStringProperty(arg, 'alias');
				if (aliasNode !== null) bindingPropertyName = aliasNode;
				required = getBooleanProperty(arg, 'required') ?? false;
				const transformNode = getProperty(arg, 'transform');
				if (transformNode && compiler) {
					transformFunction = new compiler.WrappedNodeExpr(
						transformNode
					);
				}
			}
		}

		return {
			classPropertyName,
			meta: {
				classPropertyName,
				bindingPropertyName,
				required,
				isSignal: false,
				transformFunction
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
	prop: ts.PropertyDeclaration,
	compiler: typeof import('@angular/compiler') | null
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
	let transformFunction: import('@angular/compiler').Expression | null = null;
	const optsArg = call.arguments[required ? 0 : 1];
	if (optsArg && ts.isObjectLiteralExpression(optsArg)) {
		const aliasNode = getStringProperty(optsArg, 'alias');
		if (aliasNode !== null) bindingPropertyName = aliasNode;
		const transformNode = getProperty(optsArg, 'transform');
		if (transformNode && compiler) {
			transformFunction = new compiler.WrappedNodeExpr(transformNode);
		}
	}

	return {
		classPropertyName,
		meta: {
			classPropertyName,
			bindingPropertyName,
			required,
			isSignal: true,
			transformFunction
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
	cls: ts.ClassDeclaration,
	// `compiler` is only needed for `WrappedNodeExpr` of `@Input({
	// transform })` — child-component metadata extraction (used to
	// build R3 declarations) doesn't care about transforms, so it
	// can pass null and skip that work.
	compiler: typeof import('@angular/compiler') | null
): {
	inputs: Record<string, R3InputMetadata>;
	outputs: Record<string, string>;
	hasDecoratorIO: boolean;
	hasSignalIO: boolean;
} => {
	const inputs: Record<string, R3InputMetadata> = {};
	const outputs: Record<string, string> = {};
	let hasDecoratorIO = false;
	let hasSignalIO = false;

	for (const member of cls.members) {
		if (!ts.isPropertyDeclaration(member)) continue;

		const decoratorIn = extractDecoratorInput(member, compiler);
		if (decoratorIn) {
			inputs[decoratorIn.classPropertyName] = decoratorIn.meta;
			hasDecoratorIO = true;
			continue;
		}
		const signalIn = extractSignalInput(member, compiler);
		if (signalIn) {
			inputs[signalIn.classPropertyName] = signalIn.meta;
			hasSignalIO = true;
			continue;
		}
		const decoratorOut = extractDecoratorOutput(member);
		if (decoratorOut) {
			outputs[decoratorOut.classPropertyName] = decoratorOut.bindingName;
			hasDecoratorIO = true;
			continue;
		}
		const signalOut = extractSignalOutput(member);
		if (signalOut) {
			outputs[signalOut.classPropertyName] = signalOut.bindingName;
			hasSignalIO = true;
		}
	}

	return { inputs, outputs, hasDecoratorIO, hasSignalIO };
};

/* ─── Advanced-feature metadata extraction ───────────────────
 *
 * `compileComponentFromMetadata` consumes a fully-shaped
 * `R3ComponentMetadata`. The fast path used to hard-code empty
 * placeholders for `animations` / `host` / `queries` /
 * `viewQueries` / `exportAs` / `providers` / `viewProviders` /
 * `hostDirectives` and bail to ngc's `emitHmrUpdateModule` when
 * the user's component used any of them — paying ~13s per cycle
 * for ngc's full program analysis.
 *
 * Each of those fields is either an opaque `Expression` (animations,
 * providers — runtime-evaluated as-is, no AST awareness needed) or
 * a structured shape we can parse from class-member decorators
 * (`@HostBinding`, `@HostListener`, `@ViewChild` family) and
 * field initializers (`viewChild()`/`contentChild()` signal
 * queries). Everything is a mechanical TS AST walk on the
 * already-parsed source file — no ngc, no transitive program. */

const ATTR_BINDING_RE = /^\[([^\]]+)\]$/;
const EVENT_BINDING_RE = /^\(([^)]+)\)$/;

type ParsedHost = {
	attributes: { [key: string]: import('@angular/compiler').Expression };
	listeners: { [key: string]: string };
	properties: { [key: string]: string };
	specialAttributes: { styleAttr?: string; classAttr?: string };
};

const emptyHost = (): ParsedHost => ({
	attributes: {},
	listeners: {},
	properties: {},
	specialAttributes: {}
});

/* `@Component({ host: { '[class.foo]': 'flag', '(click)': 'onClick($event)',
 * 'aria-label': 'Submit' } })` — keys ending in `[X]` go to properties,
 * `(X)` to listeners, plain to attributes. Values for properties/listeners
 * are unparsed expression strings (ngc parses them at compile time inside
 * `compileComponentFromMetadata`). */
const parseHostObjectInto = (
	host: ParsedHost,
	args: ts.ObjectLiteralExpression,
	hostExprNode: ts.ObjectLiteralExpression | null,
	compiler: typeof import('@angular/compiler')
): void => {
	const hostNode = getProperty(args, 'host');
	if (!hostNode || !ts.isObjectLiteralExpression(hostNode)) {
		// fall back to the `hostExprNode` arg if provided (callers
		// sometimes have a parsed ref already)
		if (!hostExprNode) return;
	}
	const obj = (
		hostNode && ts.isObjectLiteralExpression(hostNode)
			? hostNode
			: hostExprNode
	) as ts.ObjectLiteralExpression | null;
	if (!obj) return;

	for (const prop of obj.properties) {
		if (!ts.isPropertyAssignment(prop)) continue;
		const keyNode = prop.name;
		let key: string;
		if (
			ts.isStringLiteral(keyNode) ||
			ts.isNoSubstitutionTemplateLiteral(keyNode)
		) {
			key = keyNode.text;
		} else if (ts.isIdentifier(keyNode)) {
			key = keyNode.text;
		} else {
			continue;
		}

		const propMatch = ATTR_BINDING_RE.exec(key);
		const evtMatch = EVENT_BINDING_RE.exec(key);
		if (propMatch) {
			host.properties[propMatch[1] ?? ''] = prop.initializer
				.getText()
				.replace(/^['"]|['"]$/g, '');
		} else if (evtMatch) {
			host.listeners[evtMatch[1] ?? ''] = prop.initializer
				.getText()
				.replace(/^['"]|['"]$/g, '');
		} else {
			// Plain attribute. Value is an Expression — wrap as
			// WrappedNodeExpr so runtime evaluates it.
			host.attributes[key] = new compiler.WrappedNodeExpr(
				prop.initializer
			);
		}
	}
};

/* Collect `@HostBinding`/`@HostListener` member decorators and merge
 * into the host metadata. `@HostBinding('class.foo') prop` →
 * `properties['class.foo'] = 'prop'`. `@HostListener('click', ['$event'])
 * onClick(e) {}` → `listeners['click'] = 'onClick($event)'`. */
const mergeMemberHostDecorators = (
	host: ParsedHost,
	cls: ts.ClassDeclaration
): void => {
	for (const member of cls.members) {
		const decorators = ts.getDecorators(member) ?? [];
		for (const dec of decorators) {
			const expr = dec.expression;
			if (!ts.isCallExpression(expr)) continue;
			const fn = expr.expression;
			if (!ts.isIdentifier(fn)) continue;
			if (fn.text === 'HostBinding') {
				if (
					!ts.isPropertyDeclaration(member) &&
					!ts.isGetAccessor(member)
				)
					continue;
				const propertyName = (member.name as ts.Identifier).text;
				const target = expr.arguments[0];
				const key =
					target && ts.isStringLiteral(target)
						? target.text
						: propertyName;
				host.properties[key] = propertyName;
			} else if (fn.text === 'HostListener') {
				if (!ts.isMethodDeclaration(member)) continue;
				const methodName = (member.name as ts.Identifier).text;
				const eventArg = expr.arguments[0];
				if (!eventArg || !ts.isStringLiteral(eventArg)) continue;
				const event = eventArg.text;
				const argsArg = expr.arguments[1];
				let argsList: string[] = [];
				if (argsArg && ts.isArrayLiteralExpression(argsArg)) {
					for (const el of argsArg.elements) {
						if (ts.isStringLiteral(el)) argsList.push(el.text);
					}
				}
				host.listeners[event] = `${methodName}(${argsList.join(', ')})`;
			}
		}
	}
};

/* `@ViewChild('ref') prop: ElementRef`, `@ViewChild(SomeToken, { static: true })`,
 * `@ViewChildren(SomeToken)`, etc. */
const QUERY_DECORATORS = new Set([
	'ViewChild',
	'ViewChildren',
	'ContentChild',
	'ContentChildren'
]);

const parseQueryDecoratorOptions = (
	args: ts.NodeArray<ts.Expression>
): {
	static_: boolean;
	descendants: boolean;
	emitDistinctChangesOnly: boolean;
} => {
	let static_ = false;
	let descendants = true;
	let emitDistinctChangesOnly = true;
	const opts = args[1];
	if (opts && ts.isObjectLiteralExpression(opts)) {
		static_ = getBooleanProperty(opts, 'static') ?? false;
		descendants = getBooleanProperty(opts, 'descendants') ?? true;
		emitDistinctChangesOnly =
			getBooleanProperty(opts, 'emitDistinctChangesOnly') ?? true;
	}
	return { static_, descendants, emitDistinctChangesOnly };
};

const queryPredicateFromArg = (
	arg: ts.Expression,
	compiler: typeof import('@angular/compiler')
): string[] | import('@angular/compiler').MaybeForwardRefExpression | null => {
	if (ts.isStringLiteral(arg)) {
		// Template ref query: `@ViewChild('myRef')`. Predicate is the
		// list of template ref names.
		return arg.text
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
	}
	// Token query: `@ViewChild(SomeService)`. Wrap the identifier
	// expression as `WrappedNodeExpr` for the runtime.
	return {
		expression: new compiler.WrappedNodeExpr(arg),
		forwardRef: 0
	};
};

const extractDecoratorQueries = (
	cls: ts.ClassDeclaration,
	compiler: typeof import('@angular/compiler')
): {
	contentQueries: import('@angular/compiler').R3QueryMetadata[];
	viewQueries: import('@angular/compiler').R3QueryMetadata[];
} => {
	const contentQueries: import('@angular/compiler').R3QueryMetadata[] = [];
	const viewQueries: import('@angular/compiler').R3QueryMetadata[] = [];
	for (const member of cls.members) {
		if (!ts.isPropertyDeclaration(member)) continue;
		const decorators = ts.getDecorators(member) ?? [];
		for (const dec of decorators) {
			const expr = dec.expression;
			if (!ts.isCallExpression(expr)) continue;
			const fn = expr.expression;
			if (!ts.isIdentifier(fn) || !QUERY_DECORATORS.has(fn.text))
				continue;
			const propertyName = (member.name as ts.Identifier).text;
			const tokenArg = expr.arguments[0];
			if (!tokenArg) continue;
			const predicate = queryPredicateFromArg(tokenArg, compiler);
			if (!predicate) continue;
			const { static_, descendants, emitDistinctChangesOnly } =
				parseQueryDecoratorOptions(expr.arguments);
			const opts = expr.arguments[1];
			let read: import('@angular/compiler').Expression | null = null;
			if (opts && ts.isObjectLiteralExpression(opts)) {
				const readNode = getProperty(opts, 'read');
				if (readNode) {
					read = new compiler.WrappedNodeExpr(readNode);
				}
			}
			const meta: import('@angular/compiler').R3QueryMetadata = {
				propertyName,
				first: fn.text === 'ViewChild' || fn.text === 'ContentChild',
				predicate,
				descendants,
				emitDistinctChangesOnly,
				read,
				static: static_,
				isSignal: false
			};
			if (fn.text === 'ViewChild' || fn.text === 'ViewChildren') {
				viewQueries.push(meta);
			} else {
				contentQueries.push(meta);
			}
		}
	}
	return { contentQueries, viewQueries };
};

/* `viewChild('ref')`, `viewChild.required(SomeToken)`,
 * `contentChildren(SomeToken, { descendants: false })`, etc. */
const SIGNAL_QUERY_TO_RUNTIME: Record<
	string,
	{ isView: boolean; first: boolean }
> = {
	viewChild: { isView: true, first: true },
	viewChildren: { isView: true, first: false },
	contentChild: { isView: false, first: true },
	contentChildren: { isView: false, first: false }
};

const extractSignalQueries = (
	cls: ts.ClassDeclaration,
	compiler: typeof import('@angular/compiler')
): {
	contentQueries: import('@angular/compiler').R3QueryMetadata[];
	viewQueries: import('@angular/compiler').R3QueryMetadata[];
} => {
	const contentQueries: import('@angular/compiler').R3QueryMetadata[] = [];
	const viewQueries: import('@angular/compiler').R3QueryMetadata[] = [];
	for (const member of cls.members) {
		if (!ts.isPropertyDeclaration(member) || !member.initializer) continue;
		let init: ts.Expression = member.initializer;
		if (!ts.isCallExpression(init)) continue;

		// Disambiguate `viewChild(...)` vs `viewChild.required(...)`.
		let queryName: string;
		if (ts.isIdentifier(init.expression)) {
			queryName = init.expression.text;
		} else if (
			ts.isPropertyAccessExpression(init.expression) &&
			ts.isIdentifier(init.expression.expression) &&
			init.expression.name.text === 'required'
		) {
			queryName = init.expression.expression.text;
		} else {
			continue;
		}
		const runtime = SIGNAL_QUERY_TO_RUNTIME[queryName];
		if (!runtime) continue;

		const propertyName = (member.name as ts.Identifier).text;
		const tokenArg = init.arguments[0];
		if (!tokenArg) continue;
		const predicate = queryPredicateFromArg(tokenArg, compiler);
		if (!predicate) continue;

		let descendants = true;
		let read: import('@angular/compiler').Expression | null = null;
		const opts = init.arguments[1];
		if (opts && ts.isObjectLiteralExpression(opts)) {
			descendants = getBooleanProperty(opts, 'descendants') ?? true;
			const readNode = getProperty(opts, 'read');
			if (readNode) read = new compiler.WrappedNodeExpr(readNode);
		}

		const meta: import('@angular/compiler').R3QueryMetadata = {
			propertyName,
			first: runtime.first,
			predicate,
			descendants,
			emitDistinctChangesOnly: true,
			read,
			static: false,
			isSignal: true
		};
		if (runtime.isView) viewQueries.push(meta);
		else contentQueries.push(meta);
	}
	return { contentQueries, viewQueries };
};

const extractExportAs = (args: ts.ObjectLiteralExpression): string[] | null => {
	const node = getProperty(args, 'exportAs');
	if (!node) return null;
	if (ts.isStringLiteral(node)) {
		return node.text
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
	}
	if (ts.isArrayLiteralExpression(node)) {
		const out: string[] = [];
		for (const el of node.elements) {
			if (ts.isStringLiteral(el)) out.push(el.text);
		}
		return out.length > 0 ? out : null;
	}
	return null;
};

const extractHostDirectives = (
	args: ts.ObjectLiteralExpression,
	compiler: typeof import('@angular/compiler')
): import('@angular/compiler').R3HostDirectiveMetadata[] | null => {
	const node = getProperty(args, 'hostDirectives');
	if (!node || !ts.isArrayLiteralExpression(node)) return null;
	const out: import('@angular/compiler').R3HostDirectiveMetadata[] = [];
	for (const el of node.elements) {
		if (ts.isIdentifier(el)) {
			out.push({
				directive: {
					value: new compiler.WrappedNodeExpr(el),
					type: new compiler.WrappedNodeExpr(el)
				},
				isForwardReference: false,
				inputs: null,
				outputs: null
			});
			continue;
		}
		if (!ts.isObjectLiteralExpression(el)) continue;
		const directiveNode = getProperty(el, 'directive');
		if (!directiveNode) continue;
		const inputsNode = getProperty(el, 'inputs');
		const outputsNode = getProperty(el, 'outputs');
		const collectMap = (
			n: ts.Expression | null
		): { [k: string]: string } | null => {
			if (!n || !ts.isArrayLiteralExpression(n)) return null;
			const map: { [k: string]: string } = {};
			for (const item of n.elements) {
				if (!ts.isStringLiteral(item)) continue;
				// Format: 'name' or 'name: alias'
				const [name, alias] = item.text.split(':').map((s) => s.trim());
				if (name) map[name] = alias ?? name;
			}
			return Object.keys(map).length > 0 ? map : null;
		};
		out.push({
			directive: {
				value: new compiler.WrappedNodeExpr(directiveNode),
				type: new compiler.WrappedNodeExpr(directiveNode)
			},
			isForwardReference: false,
			inputs: collectMap(inputsNode),
			outputs: collectMap(outputsNode)
		});
	}
	return out.length > 0 ? out : null;
};

type AdvancedMetadata = {
	host: ParsedHost;
	contentQueries: import('@angular/compiler').R3QueryMetadata[];
	viewQueries: import('@angular/compiler').R3QueryMetadata[];
	exportAs: string[] | null;
	providers: import('@angular/compiler').Expression | null;
	viewProviders: import('@angular/compiler').Expression | null;
	animations: import('@angular/compiler').Expression | null;
	hostDirectives:
		| import('@angular/compiler').R3HostDirectiveMetadata[]
		| null;
};

const extractAdvancedMetadata = (
	cls: ts.ClassDeclaration,
	decoratorArgs: ts.ObjectLiteralExpression,
	compiler: typeof import('@angular/compiler')
): AdvancedMetadata => {
	const host = emptyHost();
	parseHostObjectInto(host, decoratorArgs, null, compiler);
	mergeMemberHostDecorators(host, cls);

	const decoratorQueries = extractDecoratorQueries(cls, compiler);
	const signalQueries = extractSignalQueries(cls, compiler);
	const contentQueries = [
		...decoratorQueries.contentQueries,
		...signalQueries.contentQueries
	];
	const viewQueries = [
		...decoratorQueries.viewQueries,
		...signalQueries.viewQueries
	];

	const providersNode = getProperty(decoratorArgs, 'providers');
	const providers = providersNode
		? new compiler.WrappedNodeExpr(providersNode)
		: null;

	const viewProvidersNode = getProperty(decoratorArgs, 'viewProviders');
	const viewProviders = viewProvidersNode
		? new compiler.WrappedNodeExpr(viewProvidersNode)
		: null;

	const animationsNode = getProperty(decoratorArgs, 'animations');
	const animations = animationsNode
		? new compiler.WrappedNodeExpr(animationsNode)
		: null;

	return {
		host,
		contentQueries,
		viewQueries,
		exportAs: extractExportAs(decoratorArgs),
		providers,
		viewProviders,
		animations,
		hostDirectives: extractHostDirectives(decoratorArgs, compiler)
	};
};

/* ─── Child-component metadata resolution ──────────────────────
 *
 * The fast HMR path passes empty `declarations` to
 * `compileComponentFromMetadata` (see the long comment at
 * `declarations: []` for why — emitted dependency identifiers
 * would be free variables in the surgical-update module's scope).
 *
 * Side effect: with no declarations, the template parser can't
 * recognize child component tags as components, so static
 * attributes like `<abs-image src="literal">` are encoded as
 * plain DOM attrs (before AttributeMarker.Bindings) instead of
 * input bindings. On initial render Angular's runtime input-from-
 * attribute mapping wires them up; but `ɵɵreplaceMetadata` only
 * re-runs the update path, never the initial-create input
 * mapping — so the affected input signal stays unset after HMR
 * and the re-rendered child component renders with `undefined`
 * for that input (the user's logo `<img src="">` empty bug).
 *
 * Fix: pre-process the template HTML to bracket-syntaxify any
 * static attr on a known child-component tag whose attribute
 * name matches one of that component's inputs. The compiler then
 * encodes them as proper bindings, and the HMR re-render binds
 * them correctly.
 *
 * To know which tags are components and which attrs are inputs,
 * we resolve the user's `@Component({ imports: [...] })` array:
 *   - Local imports (`./...`): parse the .ts source, extract
 *     selector + inputs the same way we do for the live class.
 *   - Library imports (bare specifiers): parse the package's
 *     shipped `.d.ts`, which has a `static ɵcmp:
 *     ɵɵComponentDeclaration<Class, "selector", _, { inputs },
 *     ...>` declaration that ngc generates for every component.
 */

type ChildComponentInfo = {
	selector: string;
	inputs: Set<string>;
	outputs: Set<string>;
	exportAs: string[] | null;
	isComponent: boolean;
};

const childComponentInfoCache = new Map<
	string,
	{ mtimeMs: number; info: ChildComponentInfo | null }
>();

const getChildComponentInfoFromTsSource = (
	filePath: string,
	className: string
): ChildComponentInfo | null => {
	const cacheKey = `ts:${filePath}:${className}`;
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(filePath);
	} catch {
		return null;
	}
	const cached = childComponentInfoCache.get(cacheKey);
	if (cached && cached.mtimeMs === stat.mtimeMs) return cached.info;

	let source: string;
	try {
		source = readFileSync(filePath, 'utf-8');
	} catch {
		childComponentInfoCache.set(cacheKey, {
			info: null,
			mtimeMs: stat.mtimeMs
		});
		return null;
	}
	const sf = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true
	);

	let info: ChildComponentInfo | null = null;
	for (const stmt of sf.statements) {
		if (!ts.isClassDeclaration(stmt)) continue;
		if (!stmt.name || stmt.name.text !== className) continue;
		const decorator = findComponentDecorator(stmt);
		if (!decorator) continue;
		const args = getDecoratorArgsObject(decorator);
		if (!args) continue;
		const meta = readDecoratorMeta(args);
		if (!meta.selector) continue;
		const { inputs, outputs } = extractInputsAndOutputs(stmt, null);
		const inputNames = new Set<string>();
		for (const value of Object.values(inputs)) {
			inputNames.add(value.bindingPropertyName);
		}
		const outputNames = new Set<string>(Object.values(outputs));
		info = {
			exportAs: null,
			inputs: inputNames,
			isComponent: true,
			outputs: outputNames,
			selector: meta.selector
		};
		break;
	}

	childComponentInfoCache.set(cacheKey, { info, mtimeMs: stat.mtimeMs });
	return info;
};

const getChildComponentInfoFromDts = (
	dtsPath: string,
	className: string
): ChildComponentInfo | null => {
	const cacheKey = `dts:${dtsPath}:${className}`;
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(dtsPath);
	} catch {
		return null;
	}
	const cached = childComponentInfoCache.get(cacheKey);
	if (cached && cached.mtimeMs === stat.mtimeMs) return cached.info;

	let content: string;
	try {
		content = readFileSync(dtsPath, 'utf-8');
	} catch {
		childComponentInfoCache.set(cacheKey, {
			info: null,
			mtimeMs: stat.mtimeMs
		});
		return null;
	}

	// Both components and directives have a similar shape:
	//   `static ɵcmp: ɵɵComponentDeclaration<Class, "selector", refs,
	//                                        { inputs }, { outputs },
	//                                        ...>`
	//   `static ɵdir: ɵɵDirectiveDeclaration<Class, "selector", refs,
	//                                        { inputs }, { outputs },
	//                                        ...>`
	const isComponentDecl = new RegExp(
		`static\\s+ɵcmp\\s*:[^<]+<\\s*${className}\\b`
	).test(content);
	const isDirectiveDecl =
		!isComponentDecl &&
		new RegExp(`static\\s+ɵdir\\s*:[^<]+<\\s*${className}\\b`).test(
			content
		);
	if (!isComponentDecl && !isDirectiveDecl) {
		childComponentInfoCache.set(cacheKey, {
			info: null,
			mtimeMs: stat.mtimeMs
		});
		return null;
	}

	const declToken = isComponentDecl ? 'ɵcmp' : 'ɵdir';
	const headerRegex = new RegExp(
		`static\\s+${declToken}\\s*:[^<]+<\\s*${className}\\s*,\\s*("[^"]+"|never)\\s*,[^,]+,\\s*\\{`
	);
	const headerMatch = headerRegex.exec(content);
	if (!headerMatch) {
		childComponentInfoCache.set(cacheKey, {
			info: null,
			mtimeMs: stat.mtimeMs
		});
		return null;
	}
	const selectorRaw = headerMatch[1] ?? '';
	const selector =
		selectorRaw.startsWith('"') && selectorRaw.endsWith('"')
			? selectorRaw.slice(1, -1)
			: '';
	if (!selector) {
		childComponentInfoCache.set(cacheKey, {
			info: null,
			mtimeMs: stat.mtimeMs
		});
		return null;
	}

	// Walk balanced braces to extract the inputs object, then the
	// outputs object (the next `{...}` after the comma).
	const sliceBalanced = (
		start: number
	): { end: number; text: string } | null => {
		let depth = 0;
		for (let i = start; i < content.length; i++) {
			const ch = content[i];
			if (ch === '{') depth++;
			else if (ch === '}') {
				depth--;
				if (depth === 0)
					return { end: i, text: content.slice(start, i + 1) };
			}
		}
		return null;
	};

	const inputsStart = (headerMatch.index ?? 0) + headerMatch[0].length - 1;
	const inputsSlice = sliceBalanced(inputsStart);
	if (!inputsSlice) {
		childComponentInfoCache.set(cacheKey, {
			info: null,
			mtimeMs: stat.mtimeMs
		});
		return null;
	}

	const outputsHeaderRe = /\s*,\s*\{/y;
	outputsHeaderRe.lastIndex = inputsSlice.end + 1;
	let outputsBlock = '';
	const outputsHeaderMatch = outputsHeaderRe.exec(content);
	if (outputsHeaderMatch) {
		const outputsStart = outputsHeaderRe.lastIndex - 1;
		const outputsSlice = sliceBalanced(outputsStart);
		if (outputsSlice) outputsBlock = outputsSlice.text;
	}

	const aliasNamesFrom = (block: string): Set<string> => {
		const out = new Set<string>();
		const re = /"([^"]+)"\s*:\s*\{[^}]*?"alias"\s*:\s*"([^"]*)"/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(block)) !== null) {
			const propName = m[1] ?? '';
			const alias = m[2] ?? '';
			out.add(alias || propName);
		}
		return out;
	};

	const info: ChildComponentInfo = {
		exportAs: null,
		inputs: aliasNamesFrom(inputsSlice.text),
		isComponent: isComponentDecl,
		outputs: aliasNamesFrom(outputsBlock),
		selector
	};
	childComponentInfoCache.set(cacheKey, { info, mtimeMs: stat.mtimeMs });
	return info;
};

const buildClassToSpecMap = (
	sourceFile: ts.SourceFile
): Map<string, string> => {
	const result = new Map<string, string>();
	for (const stmt of sourceFile.statements) {
		if (!ts.isImportDeclaration(stmt)) continue;
		if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
		const spec = stmt.moduleSpecifier.text;
		const clause = stmt.importClause;
		if (!clause || clause.isTypeOnly) continue;
		if (clause.name) result.set(clause.name.text, spec);
		const named = clause.namedBindings;
		if (named && ts.isNamedImports(named)) {
			for (const el of named.elements) {
				if (el.isTypeOnly) continue;
				result.set(el.name.text, spec);
			}
		}
	}
	return result;
};

/* Walk a package's `.d.ts` graph to find the file that contains the
 * class's `static ɵcmp` declaration. Handles the common shapes:
 *  - co-located `.d.ts` (`dist/foo.js` ↔ `dist/foo.d.ts`)
 *  - mirrored `dist/src/` types (`dist/foo.js` ↔ `dist/src/foo.d.ts`,
 *    used by @absolutejs/absolute)
 *  - barrel re-exports (`index.d.ts` re-exports `ClassName` from
 *    `./image.component` → follow that path).
 *
 * Returns the absolute path to a `.d.ts` containing `ClassName` or
 * null if we can't find it. The actual selector/inputs extraction
 * happens in `getChildComponentInfoFromDts`. */
const findDtsContainingClass = (
	startDtsPath: string,
	className: string,
	visited = new Set<string>()
): string | null => {
	if (visited.has(startDtsPath)) return null;
	visited.add(startDtsPath);
	if (!existsSync(startDtsPath)) return null;

	let content: string;
	try {
		content = readFileSync(startDtsPath, 'utf-8');
	} catch {
		return null;
	}

	const declRe = new RegExp(
		`(?:declare\\s+class|export\\s+(?:declare\\s+)?(?:class|abstract\\s+class))\\s+${className}\\b`
	);
	if (declRe.test(content)) return startDtsPath;

	// Re-export: `export { ClassName } from "./path"` or
	// `export { Foo, ClassName, Bar } from "./path"` or
	// `export * from "./path"` (must scan all star re-exports).
	const namedReExportRe = new RegExp(
		`export\\s*(?:type)?\\s*\\{([^}]*)\\}\\s*from\\s*["']([^"']+)["']`,
		'g'
	);
	let m: RegExpExecArray | null;
	while ((m = namedReExportRe.exec(content)) !== null) {
		const namedList = m[1] || '';
		const fromPath = m[2] || '';
		const names = namedList.split(',').map((n) => {
			const trimmed = n.trim();
			const asIdx = trimmed.lastIndexOf(' as ');
			return asIdx >= 0 ? trimmed.slice(asIdx + 4).trim() : trimmed;
		});
		if (!names.includes(className)) continue;
		const nextDts = resolveDtsFromSpec(fromPath, dirname(startDtsPath));
		if (!nextDts) continue;
		const found = findDtsContainingClass(nextDts, className, visited);
		if (found) return found;
	}

	const starReExportRe = /export\s*\*\s*from\s*["']([^"']+)["']/g;
	while ((m = starReExportRe.exec(content)) !== null) {
		const fromPath = m[1] || '';
		const nextDts = resolveDtsFromSpec(fromPath, dirname(startDtsPath));
		if (!nextDts) continue;
		const found = findDtsContainingClass(nextDts, className, visited);
		if (found) return found;
	}

	return null;
};

const resolveDtsFromSpec = (spec: string, fromDir: string): string | null => {
	// `.d.ts` re-exports often reference siblings with a `.js`
	// extension (`from './image.component.js'`) for ESM compliance —
	// the type information lives at the `.d.ts` next to that runtime
	// file. Strip `.js` / `.mjs` / `.cjs` before appending `.d.ts`
	// so we land on the right declaration file.
	const stripped = spec.replace(/\.[mc]?js$/, '');
	const base = resolve(fromDir, stripped);
	const candidates = [
		`${base}.d.ts`,
		`${base}.d.mts`,
		`${base}.d.cts`,
		`${base}/index.d.ts`,
		`${base}/index.d.mts`,
		`${base}/index.d.cts`
	];
	for (const c of candidates) {
		if (existsSync(c)) return c;
	}
	return null;
};

/* Read a package's exports/types entry to find the .d.ts path for a
 * given subpath. Falls back to walking common patterns if the
 * package.json lookup doesn't yield a usable path. */
const findPackageDtsForJs = (jsPath: string): string | null => {
	// Strategy 1: sibling .d.ts (co-located types).
	const sibling = jsPath.replace(/\.[mc]?js$/, '.d.ts');
	if (existsSync(sibling)) return sibling;

	// Strategy 2: mirror under `dist/src/` (the @absolutejs/absolute
	// shape — `dist/<path>.js` has its types at `dist/src/<path>.d.ts`).
	const mirror = jsPath
		.replace(/\/dist\//, '/dist/src/')
		.replace(/\.[mc]?js$/, '.d.ts');
	if (existsSync(mirror)) return mirror;

	return null;
};

const resolveChildComponentInfo = (
	className: string,
	spec: string,
	componentDir: string,
	projectRoot: string
): ChildComponentInfo | null => {
	if (spec.startsWith('.') || spec.startsWith('/')) {
		const base = resolve(componentDir, spec);
		const candidates = [
			`${base}.ts`,
			`${base}.tsx`,
			`${base}/index.ts`,
			`${base}/index.tsx`
		];
		for (const candidate of candidates) {
			if (!existsSync(candidate)) continue;
			const info = getChildComponentInfoFromTsSource(
				candidate,
				className
			);
			if (info) return info;
		}
		return null;
	}
	try {
		const resolved = Bun.resolveSync(spec, projectRoot);
		const initialDts = findPackageDtsForJs(resolved);
		if (!initialDts) return null;
		const finalDts = findDtsContainingClass(initialDts, className);
		if (!finalDts) return null;
		return getChildComponentInfoFromDts(finalDts, className);
	} catch {
		// Resolution failed — skip silently. Worst case the static-attr
		// fix doesn't apply for this child component.
	}
	return null;
};

type ResolvedImport = {
	identifier: ts.Identifier;
	info: ChildComponentInfo;
};

const buildResolvedImports = (
	sourceFile: ts.SourceFile,
	importsExpr: ts.ArrayLiteralExpression | null,
	componentDir: string,
	projectRoot: string
): ResolvedImport[] => {
	const result: ResolvedImport[] = [];
	if (!importsExpr) return result;

	const classToSpec = buildClassToSpecMap(sourceFile);

	for (const el of importsExpr.elements) {
		if (!ts.isIdentifier(el)) continue;
		const className = el.text;
		const spec = classToSpec.get(className);
		if (!spec) continue;
		const info = resolveChildComponentInfo(
			className,
			spec,
			componentDir,
			projectRoot
		);
		if (!info) continue;
		result.push({ identifier: el, info });
	}

	return result;
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
 * for every property whose initializer is one of the field-shape
 * forms whose runtime behavior cannot be propagated through the
 * Tier 0 prototype-patch alone:
 *
 *   - arrow / function expressions: the function body lives
 *     per-instance (not on the prototype), so editing the body
 *     wouldn't reach existing instances without a remount.
 *   - call expressions: covers `inject(Token, opts)`,
 *     `viewChild('ref', { read })`, `contentChild('ref', opts)`,
 *     `signal(initial)`, `computed(() => ...)`, `model(initial)`,
 *     etc. These are Angular's signal-form member declarations
 *     and DI lookups; their argument lists encode contract
 *     details (DI options, query options, signal initial values)
 *     that the runtime captures at construction time. Editing
 *     args has runtime effects the prototype-patch can't
 *     retroactively apply to existing instances.
 *   - new expressions: `private subject = new BehaviorSubject(0)`.
 *     The constructor argument changes wouldn't propagate.
 *   - conditional expressions whose branches contain any of the
 *     above structural forms (`cond ? inject(A) : inject(B)`,
 *     `flag ? signal(0) : null`). Editing the branches swaps
 *     which structural form runs at construction time; without
 *     fingerprinting we'd silently keep the pre-edit branch.
 *   - object / array literal expressions whose elements contain
 *     any of the above (`{ subject: new BehaviorSubject(0) }`,
 *     `[inject(Foo), inject(Bar)]`). Editing argument shapes
 *     of the embedded calls/news has the same propagation issue.
 *
 * Plain literal initializers (`count = 0`, `data = {}`,
 * `name = 'foo'`) are still NOT included; those edits stay no-op
 * so existing instance state is preserved. */
const initializerShapeIsStructural = (node: ts.Expression): boolean => {
	if (
		ts.isArrowFunction(node) ||
		ts.isFunctionExpression(node) ||
		ts.isCallExpression(node) ||
		ts.isNewExpression(node)
	) {
		return true;
	}
	if (ts.isConditionalExpression(node)) {
		return (
			initializerShapeIsStructural(node.whenTrue) ||
			initializerShapeIsStructural(node.whenFalse)
		);
	}
	if (ts.isParenthesizedExpression(node)) {
		return initializerShapeIsStructural(node.expression);
	}
	if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
		return initializerShapeIsStructural(node.expression);
	}
	if (ts.isNonNullExpression(node)) {
		return initializerShapeIsStructural(node.expression);
	}
	if (ts.isObjectLiteralExpression(node)) {
		for (const prop of node.properties) {
			if (
				ts.isPropertyAssignment(prop) &&
				initializerShapeIsStructural(prop.initializer)
			) {
				return true;
			}
			if (ts.isShorthandPropertyAssignment(prop)) continue;
			if (
				ts.isSpreadAssignment(prop) &&
				initializerShapeIsStructural(prop.expression)
			) {
				return true;
			}
		}
		return false;
	}
	if (ts.isArrayLiteralExpression(node)) {
		for (const el of node.elements) {
			if (initializerShapeIsStructural(el)) return true;
		}
		return false;
	}
	return false;
};

const extractArrowFieldSig = (cls: ts.ClassDeclaration): string[] => {
	const entries: string[] = [];
	for (const member of cls.members) {
		if (!ts.isPropertyDeclaration(member)) continue;
		const init = member.initializer;
		if (!init) continue;
		if (!initializerShapeIsStructural(init)) continue;
		const name = member.name.getText();
		// Use the TS printer to produce a canonical text form so
		// cosmetic edits (reformatting, comment churn) don't flip
		// the fingerprint. Falls back to `getText()` if printing
		// throws — comparison is still source-text-based then, just
		// with whitespace sensitivity.
		let bodyText: string;
		try {
			const printer = ts.createPrinter({
				newLine: ts.NewLineKind.LineFeed,
				omitTrailingSemicolon: true,
				removeComments: true
			});
			bodyText = printer.printNode(
				ts.EmitHint.Unspecified,
				init,
				cls.getSourceFile()
			);
		} catch {
			bodyText = init.getText();
		}
		const bodyHash = djb2Hash(bodyText);
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
 * gap, see ABSOLUTEJS_ANGULAR_HMR.md.) */
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
					argText = expr.arguments.map((a) => a.getText()).join(',');
				}
			} else if (ts.isIdentifier(expr)) {
				decName = expr.text;
			}
			if (INPUT_OUTPUT_DECORATORS.has(decName)) continue;
			entries.push(`${decName}:${memberName}:${djb2Hash(argText)}`);
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
		if (importClause.name && importClause.name.text === identifierName) {
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
/* Extract the sorted set of class member names — both property
 * declarations AND method/accessor declarations. The set is
 * intentionally name-only: changes to a property's initializer
 * value (e.g., `count = 0` → `count = 5`) or a method body leave
 * the set unchanged and stay on Tier 0 surgical, preserving the
 * running instance's state and patching method bodies onto the
 * prototype. Additions and removals of any class member shift
 * the set and force Tier 1a remount.
 *
 * Methods are captured because adding a NEW method with a
 * lifecycle-significant name (`ngOnInit`, `ngOnDestroy`,
 * `ngAfterViewInit`, etc.) needs Tier 1a to recreate the
 * instance: Angular's lifecycle hook table is captured at
 * `ɵɵdefineComponent` / `createView` time, so a prototype patch
 * alone puts the method on the prototype but the existing LView's
 * lifecycle table doesn't include it and the hook never fires.
 * Capturing all method names (not just lifecycle ones) keeps the
 * rule simple and also covers the case where a method is
 * referenced by a parent component via template ref.
 *
 * Constructor parameter properties (`constructor(private foo:
 * T)`) are not iterated here; their addition / removal is
 * captured by `ctorParamTypes`. */
const extractPropertyFieldNames = (cls: ts.ClassDeclaration): string[] => {
	const names: string[] = [];
	for (const member of cls.members) {
		if (
			!ts.isPropertyDeclaration(member) &&
			!ts.isMethodDeclaration(member) &&
			!ts.isGetAccessorDeclaration(member) &&
			!ts.isSetAccessorDeclaration(member)
		) {
			continue;
		}
		const name = member.name;
		if (name === undefined) continue;
		const text = ts.isIdentifier(name)
			? name.text
			: ts.isStringLiteral(name) ||
				  ts.isNoSubstitutionTemplateLiteral(name)
				? name.text
				: name.getText();
		if (text.length > 0) names.push(text);
	}
	return names.sort();
};

/* Extract the sorted set of top-level import bindings from a source
 * file. Includes default imports, named imports (alias-aware: the
 * local binding name, not the imported name), and namespace
 * imports. Type-only imports are excluded since they have no runtime
 * binding. */
const extractTopLevelImports = (sourceFile: ts.SourceFile): string[] => {
	const names = new Set<string>();
	for (const stmt of sourceFile.statements) {
		if (!ts.isImportDeclaration(stmt)) continue;
		const clause = stmt.importClause;
		if (!clause) continue;
		if (clause.isTypeOnly) continue;
		if (clause.name) names.add(clause.name.text);
		const bindings = clause.namedBindings;
		if (!bindings) continue;
		if (ts.isNamespaceImport(bindings)) {
			names.add(bindings.name.text);
		} else if (ts.isNamedImports(bindings)) {
			for (const el of bindings.elements) {
				if (el.isTypeOnly) continue;
				names.add(el.name.text);
			}
		}
	}
	return [...names].sort();
};

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
			const typeText = param.type ? param.type.getText() : '';
			/* Include the parameter's Angular DI decorators
			 * (`@Optional`, `@Self`, `@SkipSelf`, `@Host`,
			 * `@Inject(...)`) in the per-parameter fingerprint
			 * string. Adding or removing one of these without
			 * changing the type would otherwise leave the
			 * fingerprint unchanged; the live class's preserved
			 * `ɵfac` would keep its pre-edit DI behavior on
			 * Tier 0 cycles. Capturing them forces Tier 1a
			 * remount, which fetches a fresh class whose `ɵfac`
			 * reflects the new constructor signature. */
			const decorators = ts.getDecorators(param) ?? [];
			const decoratorSig =
				decorators.length === 0
					? ''
					: decorators
							.map((d) => {
								const expr = d.expression;
								if (
									ts.isCallExpression(expr) &&
									ts.isIdentifier(expr.expression)
								) {
									const args = expr.arguments
										.map((a) => a.getText())
										.join(',');
									return `@${expr.expression.text}(${args})`;
								}
								if (ts.isIdentifier(expr)) {
									return `@${expr.text}`;
								}
								return '@<unknown>';
							})
							.join('');
			ctorParamTypes.push(`${typeText}${decoratorSig}`);
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

	const topLevelImports = extractTopLevelImports(sourceFile);
	const propertyFieldNames = extractPropertyFieldNames(cls);

	// Normalize whitespace + comments before hashing so cosmetic
	// edits (reformatting, adding trailing commas, comment churn)
	// don't flip a fingerprint and cause spurious Tier 1a / Tier 1b
	// cycles. Uses the TS printer's `removeComments + omitTrailingSemicolon`
	// emit to produce a canonical text form keyed on AST structure
	// rather than source bytes.
	const printer = ts.createPrinter({
		newLine: ts.NewLineKind.LineFeed,
		omitTrailingSemicolon: true,
		removeComments: true
	});
	const canonicalText = (node: ts.Node) =>
		printer.printNode(ts.EmitHint.Unspecified, node, sourceFile);
	const importsArraySig = decoratorMeta.importsExpr
		? djb2Hash(canonicalText(decoratorMeta.importsExpr))
		: '';
	const hostDirectivesSig = decoratorMeta.hostDirectivesExpr
		? djb2Hash(canonicalText(decoratorMeta.hostDirectivesExpr))
		: '';
	const animationsArraySig = decoratorMeta.animationsExpr
		? djb2Hash(canonicalText(decoratorMeta.animationsExpr))
		: '';
	const providersArraySig = decoratorMeta.providersExpr
		? djb2Hash(canonicalText(decoratorMeta.providersExpr))
		: '';
	const viewProvidersArraySig = decoratorMeta.viewProvidersExpr
		? djb2Hash(canonicalText(decoratorMeta.viewProvidersExpr))
		: '';
	const decoratorInputsArraySig = decoratorMeta.inputsArrayExpr
		? djb2Hash(canonicalText(decoratorMeta.inputsArrayExpr))
		: '';
	const decoratorOutputsArraySig = decoratorMeta.outputsArrayExpr
		? djb2Hash(canonicalText(decoratorMeta.outputsArrayExpr))
		: '';
	const hostBindingsSig = decoratorMeta.hostExpr
		? djb2Hash(canonicalText(decoratorMeta.hostExpr))
		: '';
	const schemasSig = decoratorMeta.schemasExpr
		? djb2Hash(canonicalText(decoratorMeta.schemasExpr))
		: '';

	// Hash module-level `export const providers = [...]` and
	// `export const routes = [...]` declarations. These live
	// outside the `@Component` decorator but the absolutejs
	// bootstrap path passes them to `bootstrapApplication`, so
	// edits reshape the DI / router tree at bootstrap time.
	// Existing component instances hold the OLD tree's resolved
	// values, so a change forces Tier 1b rebootstrap. Other
	// `export const ...` declarations (page metadata, types) are
	// not hashed — only the names the framework consumes.
	const PAGE_EXPORT_NAMES = new Set(['providers', 'routes']);
	const pageExportEntries: string[] = [];
	for (const stmt of sourceFile.statements) {
		if (!ts.isVariableStatement(stmt)) continue;
		const isExported = stmt.modifiers?.some(
			(m) => m.kind === ts.SyntaxKind.ExportKeyword
		);
		if (!isExported) continue;
		for (const decl of stmt.declarationList.declarations) {
			if (!ts.isIdentifier(decl.name)) continue;
			if (!PAGE_EXPORT_NAMES.has(decl.name.text)) continue;
			if (!decl.initializer) continue;
			pageExportEntries.push(
				`${decl.name.text}=${djb2Hash(canonicalText(decl.initializer))}`
			);
		}
	}
	pageExportEntries.sort();
	const pageExportsSig =
		pageExportEntries.length > 0 ? pageExportEntries.join('|') : '';

	return {
		animationsArraySig,
		arrowFieldSig,
		changeDetection: decoratorMeta.changeDetection,
		className,
		ctorParamTypes,
		decoratorInputsArraySig,
		decoratorOutputsArraySig,
		encapsulation: decoratorMeta.encapsulation,
		hasProviders: decoratorMeta.hasProviders,
		hasViewProviders: decoratorMeta.hasViewProviders,
		hostBindingsSig,
		hostDirectivesSig,
		importsArraySig,
		inputs: inputNames,
		memberDecoratorSig,
		outputs: outputNames,
		pageExportsSig,
		propertyFieldNames,
		providerImportSig,
		providersArraySig,
		schemasSig,
		selector: decoratorMeta.selector,
		standalone: decoratorMeta.standalone,
		topLevelImports,
		viewProvidersArraySig
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
	const memberSources: string[] = [];
	let hasStatic = false;
	const printer = ts.createPrinter({ removeComments: true });
	for (const member of classNode.members) {
		// Property declarations (`private foo = inject(Foo)` etc.) are
		// the field initializers Tier 1a needs to refresh on the fresh
		// instance — they're part of the constructor body in compiled
		// output. Tier 0's prototype patch ignores these (they aren't
		// on the prototype), so including them here is harmless for
		// Tier 0 and required for Tier 1a's `new _Fresh()`.
		if (ts.isPropertyDeclaration(member)) {
			const modifiers = (ts.getModifiers(member) ?? []).filter(
				(m) =>
					m.kind !== ts.SyntaxKind.Decorator &&
					m.kind !== ts.SyntaxKind.PrivateKeyword &&
					m.kind !== ts.SyntaxKind.PublicKeyword &&
					m.kind !== ts.SyntaxKind.ProtectedKeyword &&
					m.kind !== ts.SyntaxKind.ReadonlyKeyword &&
					m.kind !== ts.SyntaxKind.OverrideKeyword
			);
			const cleaned = ts.factory.createPropertyDeclaration(
				modifiers,
				member.name,
				undefined,
				undefined,
				member.initializer
			);
			memberSources.push(
				printer.printNode(
					ts.EmitHint.Unspecified,
					cleaned,
					classNode.getSourceFile()
				)
			);
			continue;
		}

		if (ts.isConstructorDeclaration(member)) {
			// Strip TS-only param decorators (Inject, Optional, etc.)
			// and parameter-property modifiers — the JS-level
			// equivalent for parameter properties is constructor-body
			// assignment (`this.foo = foo`), which TS's transpileModule
			// emits. Keep the body verbatim.
			const cleanedParams = member.parameters.map((param) =>
				ts.factory.updateParameterDeclaration(
					param,
					(ts.getModifiers(param) ?? []).filter(
						(m) =>
							m.kind !== ts.SyntaxKind.Decorator &&
							m.kind !== ts.SyntaxKind.PrivateKeyword &&
							m.kind !== ts.SyntaxKind.PublicKeyword &&
							m.kind !== ts.SyntaxKind.ProtectedKeyword &&
							m.kind !== ts.SyntaxKind.ReadonlyKeyword &&
							m.kind !== ts.SyntaxKind.OverrideKeyword
					),
					param.dotDotDotToken,
					param.name,
					param.questionToken,
					param.type,
					param.initializer
				)
			);
			const cleaned = ts.factory.createConstructorDeclaration(
				[],
				cleanedParams,
				member.body
			);
			memberSources.push(
				printer.printNode(
					ts.EmitHint.Unspecified,
					cleaned,
					classNode.getSourceFile()
				)
			);
			continue;
		}

		if (
			ts.isMethodDeclaration(member) ||
			ts.isGetAccessorDeclaration(member) ||
			ts.isSetAccessorDeclaration(member)
		) {
			const modifiers = ts.getModifiers(member) ?? [];
			const isStatic = modifiers.some(
				(m) => m.kind === ts.SyntaxKind.StaticKeyword
			);
			if (isStatic) hasStatic = true;

			// Reconstruct the method without decorators or parameter
			// decorators. Decorators reference symbols
			// (`@HostListener`, `@Input`, `@ViewChild`, ...) that
			// aren't imported into the surgical update module's
			// scope, so leaving them in `_Fresh.prototype` produces
			// `ReferenceError: HostListener is not defined` at apply
			// time. The decorators were applied to the live class at
			// its original construction; we don't re-apply them here
			// because surgical only needs the method bodies on the
			// prototype.
			const cleanedParams = member.parameters.map((param) =>
				ts.factory.updateParameterDeclaration(
					param,
					(ts.getModifiers(param) ?? []).filter(
						(m) =>
							// Strip parameter decorators (Inject, Optional,
							// etc.) for the same reason — they reference
							// runtime-imported symbols.
							m.kind !== ts.SyntaxKind.Decorator
					),
					param.dotDotDotToken,
					param.name,
					param.questionToken,
					param.type,
					param.initializer
				)
			);
			let cleaned: ts.Node;
			if (ts.isMethodDeclaration(member)) {
				cleaned = ts.factory.createMethodDeclaration(
					modifiers.filter((m) => m.kind !== ts.SyntaxKind.Decorator),
					member.asteriskToken,
					member.name,
					member.questionToken,
					member.typeParameters,
					cleanedParams,
					member.type,
					member.body
				);
			} else if (ts.isGetAccessorDeclaration(member)) {
				cleaned = ts.factory.createGetAccessorDeclaration(
					modifiers.filter((m) => m.kind !== ts.SyntaxKind.Decorator),
					member.name,
					cleanedParams,
					member.type,
					member.body
				);
			} else {
				cleaned = ts.factory.createSetAccessorDeclaration(
					modifiers.filter((m) => m.kind !== ts.SyntaxKind.Decorator),
					member.name,
					cleanedParams,
					member.body
				);
			}

			const printed = printer.printNode(
				ts.EmitHint.Unspecified,
				cleaned,
				classNode.getSourceFile()
			);
			memberSources.push(printed);
		}
	}
	if (memberSources.length === 0) return null;

	const wrappedSource = `class _Fresh {\n${memberSources.join('\n')}\n}`;
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

/* Read a `.css` / `.scss` / `.sass` / `.less` / `.styl` file from
 * disk and preprocess it to plain CSS so it can be inlined into
 * `R3ComponentMetadata.styles` (Angular's runtime applies these
 * strings as `<style>` tags directly). For `.scss` and `.sass`,
 * `compileStyleFileIfNeededSync` invokes Sass's sync compileString.
 * Any other extension falls through to the raw read; for `.css` the
 * raw contents are already valid, and for `.less` / `.styl` the
 * shared preprocessor helper throws (those need an async path that
 * the fast extractor cannot await on). Returns `null` if the file
 * is missing or preprocessing fails. */
const STYLE_PREPROCESSED_EXT = new Set([
	'.scss',
	'.sass',
	'.css',
	'.less',
	'.styl',
	'.stylus'
]);

const resolveAndReadStyleResource = (
	componentDir: string,
	url: string
): string | null => {
	const abs = resolve(componentDir, url);
	if (!existsSync(abs)) return null;
	const ext = extname(abs).toLowerCase();
	if (!STYLE_PREPROCESSED_EXT.has(ext) || ext === '.css') {
		return readFileSync(abs, 'utf8');
	}
	try {
		const { compileStyleFileIfNeededSync } =
			require('../../build/stylePreprocessor') as typeof import('../../build/stylePreprocessor');
		return compileStyleFileIfNeededSync(abs);
	} catch {
		// Less / Stylus / missing-sass cases land here. Returning
		// null causes the caller to surface as
		// `style-resource-not-found`, which the dispatcher routes
		// to the user-fixable error overlay. The user sees a clear
		// message instead of silently-broken styles.
		return null;
	}
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
		const css = resolveAndReadStyleResource(componentDir, url);
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

/* ─── Project tsconfig: angularCompilerOptions ──────────────────
 *
 * Read once per project root and cached for the lifetime of the
 * dev server. The full coverage matrix for every public option in
 * `@angular/compiler-cli`'s `angularCompilerOptions` is documented
 * in ABSOLUTEJS_ANGULAR_HMR.md §9.2; the short version:
 *
 * Propagated to IR / parseTemplate:
 *   - preserveWhitespaces, enableI18nLegacyMessageIdFormat,
 *     i18nUseExternalIds, i18nNormalizeLineEndingsInICUs
 *
 * Documented divergence (HMR runtime contract requires full IR):
 *   - compilationMode
 *
 * TCB-only (delegated to absolute typecheck and editor TS server):
 *   - All strict* family, strictStandalone, typeCheckHostBindings,
 *     extendedDiagnostics, fullTemplateTypeCheck
 *
 * Build / library / extraction-only (not applicable to HMR):
 *   - flatModuleOutFile, flatModuleId, allowEmptyCodegenFiles,
 *     i18nIn{Locale,File,Format}, i18nOut{Locale,File,Format},
 *     i18nPreserveWhitespaceForLegacyExtraction,
 *     compileNonExportedClasses, disableTypeScriptVersionCheck,
 *     forbidOrphanComponents
 *
 * Bazel/G3-internal:
 *   - generateDeepReexports, onlyPublishPublicTypingsForNgModules,
 *     annotateForClosureCompiler, generateExtraImportsInLocalMode,
 *     _experimentalAllowEmitDeclarationOnly
 *
 * Conditional on future feature work:
 *   - onlyExplicitDeferDependencyImports (would matter when fast
 *     path gains @defer-block dependency extraction)
 *
 * Internal/test-only (`_*` prefix): not honored. */
type ProjectAngularCompilerOptions = {
	preserveWhitespaces?: boolean;
	enableI18nLegacyMessageIdFormat?: boolean;
	i18nUseExternalIds?: boolean;
	i18nNormalizeLineEndingsInICUs?: boolean;
};

const projectOptionsCache = new Map<string, ProjectAngularCompilerOptions>();

const readProjectAngularCompilerOptions = (
	projectRoot: string
): ProjectAngularCompilerOptions => {
	const cached = projectOptionsCache.get(projectRoot);
	if (cached !== undefined) return cached;
	const tsconfigPath = resolve(projectRoot, 'tsconfig.json');
	const opts: ProjectAngularCompilerOptions = {};
	if (existsSync(tsconfigPath)) {
		try {
			const text = readFileSync(tsconfigPath, 'utf8');
			const parsed = ts.parseConfigFileTextToJson(tsconfigPath, text);
			if (!parsed.error && parsed.config) {
				const cfg = parsed.config as {
					angularCompilerOptions?: {
						preserveWhitespaces?: unknown;
						enableI18nLegacyMessageIdFormat?: unknown;
						i18nUseExternalIds?: unknown;
						i18nNormalizeLineEndingsInICUs?: unknown;
					};
				};
				const ang = cfg.angularCompilerOptions ?? {};
				if (typeof ang.preserveWhitespaces === 'boolean') {
					opts.preserveWhitespaces = ang.preserveWhitespaces;
				}
				if (typeof ang.enableI18nLegacyMessageIdFormat === 'boolean') {
					opts.enableI18nLegacyMessageIdFormat =
						ang.enableI18nLegacyMessageIdFormat;
				}
				if (typeof ang.i18nUseExternalIds === 'boolean') {
					opts.i18nUseExternalIds = ang.i18nUseExternalIds;
				}
				if (typeof ang.i18nNormalizeLineEndingsInICUs === 'boolean') {
					opts.i18nNormalizeLineEndingsInICUs =
						ang.i18nNormalizeLineEndingsInICUs;
				}
			}
		} catch {
			/* fall through with empty opts */
		}
	}
	projectOptionsCache.set(projectRoot, opts);
	return opts;
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
	// metadata (`@Pipe.name`, `@Directive.selector`,
	// `@Injectable.providedIn`, etc.) doesn't normally change
	// per-edit; only method bodies do, and those propagate via
	// the prototype-patch.
	//
	// When the user DOES edit decorator arguments
	// (`@Pipe({ name: 'old' })` → `@Pipe({ name: 'new' })`,
	// `@Directive({ selector: '[old]' })` → `@Directive({ selector: '[new]' })`,
	// `@Injectable({ providedIn: 'root' })` → `@Injectable({ providedIn: 'platform' })`),
	// we need to escalate. Pipe/directive selectors and DI shape
	// changes have runtime effects the prototype-patch can't
	// reach: live template instructions match by old selector,
	// existing service singletons hold the old factory, etc.
	// `entityFingerprintCache` records each entity's structural
	// surface (decorator-args text, ctor param signature, top-level
	// imports, member decorators, field set, arrow-field hashes);
	// mismatch returns `fail('structural-change', ...)` which the
	// dispatcher escalates to Tier 1b rebootstrap. First-call seeds
	// the cache and proceeds normally.
	const kind: AngularEntityKind = params.kind ?? 'component';
	if (kind !== 'component') {
		const entityId = encodeURIComponent(
			`${relative(projectRoot, componentFilePath).replace(/\\/g, '/')}@${className}`
		);
		const currentEntityFingerprint = extractEntityFingerprint(
			classNode,
			className,
			sourceFile
		);
		const cachedEntityFingerprint = entityFingerprintCache.get(entityId);
		if (
			cachedEntityFingerprint !== undefined &&
			!entityFingerprintsEqual(
				cachedEntityFingerprint,
				currentEntityFingerprint
			)
		) {
			return fail(
				'structural-change',
				`${kind} ${className} decorator-args or structural surface changed`
			);
		}

		const moduleText = buildSimpleEntityModule(classNode, className);
		if (!moduleText) {
			return fail(
				'unexpected-error',
				`buildSimpleEntityModule returned null for ${className}`
			);
		}

		entityFingerprintCache.set(entityId, currentEntityFingerprint);
		return {
			componentSource: sourceFile,
			fingerprintChanged: false,
			moduleText,
			ok: true,
			rebootstrapRequired: false
		};
	}

	if (
		inheritsDecoratedClass(
			classNode,
			sourceFile,
			dirname(componentFilePath),
			projectRoot
		)
	) {
		return fail('inherits-decorated-class');
	}

	const decorator = findComponentDecorator(classNode);
	if (!decorator) return fail('no-component-decorator');

	const decoratorArgs = getDecoratorArgsObject(decorator);
	if (!decoratorArgs) return fail('unsupported-decorator-args');

	const projectDefaults = readProjectAngularCompilerOptions(projectRoot);
	const decoratorMeta = readDecoratorMeta(decoratorArgs, projectDefaults);

	const advancedMetadata = extractAdvancedMetadata(
		classNode,
		decoratorArgs,
		compiler
	);

	const componentDir = dirname(componentFilePath);
	let templateText: string;
	let templatePath: string;
	if (decoratorMeta.template !== null) {
		templateText = decoratorMeta.template;
		templatePath = componentFilePath;
	} else if (decoratorMeta.templateUrl) {
		const tplAbs = resolve(componentDir, decoratorMeta.templateUrl);
		if (!existsSync(tplAbs)) {
			return fail(
				'template-resource-not-found',
				`Template file not found: ${tplAbs}`,
				{ file: componentFilePath }
			);
		}
		templateText = readFileSync(tplAbs, 'utf8');
		templatePath = tplAbs;
	} else {
		return fail(
			'unsupported-decorator-args',
			'missing template/templateUrl'
		);
	}

	const { styles, missing: missingStyle } = collectStyles(
		decoratorMeta,
		componentDir
	);
	if (missingStyle) {
		return fail(
			'style-resource-not-found',
			`Style file not found: ${missingStyle}`,
			{ file: componentFilePath }
		);
	}

	// Resolve `@Component({ imports: [...] })` to ChildComponentInfo
	// per import — selector + inputs + outputs + isComponent. ngc
	// uses this metadata while parsing the template so static attrs
	// on component tags (`<abs-image src="literal">`) get encoded as
	// proper input bindings instead of plain DOM attributes; without
	// it, the surgical-update IR has those attrs as static DOM attrs
	// and `ɵɵreplaceMetadata`'s re-render leaves the child
	// component's required input signals unset → empty `<img src="">`.
	const resolvedImports = buildResolvedImports(
		sourceFile,
		decoratorMeta.importsExpr,
		componentDir,
		projectRoot
	);

	let parsed: ReturnType<typeof compiler.parseTemplate>;
	try {
		parsed = compiler.parseTemplate(templateText, templatePath, {
			enableI18nLegacyMessageIdFormat:
				projectDefaults.enableI18nLegacyMessageIdFormat,
			i18nNormalizeLineEndingsInICUs:
				projectDefaults.i18nNormalizeLineEndingsInICUs,
			preserveWhitespaces: decoratorMeta.preserveWhitespaces
		});
	} catch (err) {
		return fail('template-parse-error', String(err), {
			file: templatePath
		});
	}
	if (parsed.errors && parsed.errors.length > 0) {
		const first = parsed.errors[0];
		const span = first?.span;
		const start = span?.start;
		const lineIndex = start?.line;
		const colIndex = start?.col;
		const lineTextValue =
			typeof lineIndex === 'number' && lineIndex >= 0
				? (templateText.split(/\r?\n/)[lineIndex] ?? undefined)
				: undefined;
		return fail(
			'template-parse-error',
			parsed.errors.map((e) => e.toString()).join('\n'),
			{
				file: templatePath,
				line: typeof lineIndex === 'number' ? lineIndex + 1 : undefined,
				column: typeof colIndex === 'number' ? colIndex + 1 : undefined,
				lineText: lineTextValue
			}
		);
	}

	const className_ = classNode.name;
	if (!className_) return fail('class-not-found', 'anonymous class');
	const wrappedClass = new compiler.WrappedNodeExpr(className_);

	const { inputs, outputs, hasDecoratorIO, hasSignalIO } =
		extractInputsAndOutputs(classNode, compiler);

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
	const fingerprintId = encodeURIComponent(`${projectRelPath}@${className}`);
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
	const fingerprintChanged =
		cachedFingerprint !== undefined &&
		!fingerprintsEqual(cachedFingerprint, currentFingerprint);
	const rebootstrapRequired =
		// Non-standalone (`@NgModule`-declared) components don't
		// surface a client-side LView via the standalone-bootstrap
		// path Angular uses today, so `ɵɵreplaceMetadata` has
		// nowhere to walk and Tier 0 / Tier 1a both silently
		// no-op for them. Force Tier 1b on every edit so the
		// rebuilt bundle re-renders the SSR + hydration tree
		// from scratch with the new metadata.
		!currentFingerprint.standalone ||
		(cachedFingerprint !== undefined &&
			(cachedFingerprint.importsArraySig !==
				currentFingerprint.importsArraySig ||
				cachedFingerprint.hostDirectivesSig !==
					currentFingerprint.hostDirectivesSig ||
				cachedFingerprint.providersArraySig !==
					currentFingerprint.providersArraySig ||
				cachedFingerprint.viewProvidersArraySig !==
					currentFingerprint.viewProvidersArraySig ||
				// Renaming `selector: 'old'` to `'new'` breaks
				// every parent template's tag match — existing
				// hostElements rendered with the OLD tag don't
				// re-match the NEW tag, and a Tier 1a remount
				// against the same hostElement preserves the
				// stale tag. Force Tier 1b so the parent
				// template's bundle is rebuilt and re-rendered
				// against the new selector.
				cachedFingerprint.selector !==
					currentFingerprint.selector ||
				// Module-level `export const providers = [...]` /
				// `export const routes = [...]` reshape the DI /
				// router tree at app-bootstrap; existing
				// instances hold the OLD tree's resolved values.
				// Force Tier 1b so the rebuilt bundle re-runs
				// `bootstrapApplication` with the new providers.
				cachedFingerprint.pageExportsSig !==
					currentFingerprint.pageExportsSig ||
				// Toggling `standalone: true` ↔
				// `standalone: false` reshapes the entire DI /
				// module-of-one wiring; existing LViews can't be
				// re-parented from the standalone path to
				// NgModule-declared and vice versa. Force Tier
				// 1b.
				cachedFingerprint.standalone !==
					currentFingerprint.standalone));

	// Source span — the compiler wants it but the values are only
	// used for diagnostics we never surface, so a zero span pointing
	// at the class node is fine.
	const sourceFileObj = new compiler.ParseSourceFile(
		tsSource,
		componentFilePath
	);
	const zeroLoc = new compiler.ParseLocation(sourceFileObj, 0, 0, 0);
	const typeSourceSpan = new compiler.ParseSourceSpan(zeroLoc, zeroLoc);

	/* Build `declarations` from the user's `@Component({ imports: [...] })`
	 * — ngc needs the selector + input list of every imported
	 * directive/component to produce a correct AOT IR. Without
	 * declarations the parser can't recognize child component tags
	 * as components, so static attributes (`<abs-image src="...">`)
	 * get encoded as plain DOM attrs instead of input bindings; on
	 * `ɵɵreplaceMetadata` the child component's required input
	 * signals stay unset and the inner template renders empty.
	 *
	 * The `type` field references the original AST identifier from
	 * the user's source file (`ImageComponent`, etc.). Those names
	 * are also injected into `${ClassName}.__abs_deps` by
	 * `hmrInjectionPlugin`, and the surgical-update function
	 * destructures them at the top — so when ngc emits the
	 * `dependencies` closure with those identifiers, they resolve
	 * correctly inside the surgical-update module's scope.
	 *
	 * `declarationListEmitMode: Closure` (1) wraps the emitted
	 * dependency list in a function. `ɵɵreplaceMetadata`'s
	 * `mergeWithExistingDefinition` preserves the running
	 * component's `directiveDefs`, so the closure is only invoked
	 * if Angular's runtime needs to resolve a NEW dependency that
	 * wasn't there before (which the fingerprint check already
	 * escalates to Tier 1, retiring this code path). The lazy form
	 * is what makes the `__abs_deps` destructure load-bearing
	 * across the rare-but-possible call. */
	const declarations: unknown[] = resolvedImports.map((entry) => ({
		exportAs: entry.info.exportAs,
		inputs: Array.from(entry.info.inputs),
		isComponent: entry.info.isComponent,
		kind: 0,
		outputs: Array.from(entry.info.outputs),
		selector: entry.info.selector,
		type: new compiler.WrappedNodeExpr(entry.identifier)
	}));

	const meta = {
		name: className,
		type: { value: wrappedClass, type: wrappedClass },
		typeArgumentCount: 0,
		typeSourceSpan,
		deps: null,
		selector: decoratorMeta.selector,
		queries: advancedMetadata.contentQueries,
		viewQueries: advancedMetadata.viewQueries,
		host: advancedMetadata.host,
		lifecycle: {
			/* `ngOnChanges` is special: the runtime needs this flag
			 * to wrap input setters with change-tracking so the
			 * hook is called when bindings update. Detected by
			 * presence of a class member named `ngOnChanges` (any
			 * method declaration; signature shape isn't relevant
			 * for the flag). */
			usesOnChanges: classNode.members.some(
				(m) =>
					ts.isMethodDeclaration(m) &&
					m.name !== undefined &&
					ts.isIdentifier(m.name) &&
					m.name.text === 'ngOnChanges'
			)
		},
		inputs,
		outputs,
		usesInheritance: false,
		controlCreate: extractControlCreate(classNode),
		exportAs: advancedMetadata.exportAs,
		providers: advancedMetadata.providers,
		isStandalone: decoratorMeta.standalone,
		/* "Fully signal-based" detection: at least one signal-form
		 * input/output/query, AND zero decorator-form @Input,
		 * @Output, @ViewChild, @ViewChildren, @ContentChild, or
		 * @ContentChildren members. The runtime uses this flag to
		 * pick `getInitialLViewFlagsFromDef`'s signal flag (4096),
		 * which switches LViews to fine-grained reactivity instead
		 * of Zone-driven dirty-checking. Components that mix
		 * decorator-form and signal-form members fall through to
		 * `false`, matching ngc's conservative "all-or-nothing"
		 * shape. */
		isSignal:
			(hasSignalIO ||
				advancedMetadata.contentQueries.some((q) => q.isSignal) ||
				advancedMetadata.viewQueries.some((q) => q.isSignal)) &&
			!hasDecoratorIO &&
			!advancedMetadata.contentQueries.some((q) => !q.isSignal) &&
			!advancedMetadata.viewQueries.some((q) => !q.isSignal),
		hostDirectives: advancedMetadata.hostDirectives,
		template: {
			nodes: parsed.nodes,
			ngContentSelectors: parsed.ngContentSelectors ?? [],
			preserveWhitespaces: decoratorMeta.preserveWhitespaces
		},
		declarations,
		// `@defer` block handling for HMR. PerBlock mode (mode 0)
		// requires every TmplAstDeferredBlock to have a per-block
		// dependency function entry, or `compileComponentFromMetadata`
		// throws "unable to find a dependency function for this
		// deferred block". PerComponent mode (mode 1) with a
		// `dependenciesFn: null` is supported by the runtime: the
		// deferred-block resolver short-circuits to "loading
		// complete" (no async deps) and renders the block's content
		// against whatever directiveDefs the live component already
		// has, which `mergeWithExistingDefinition` preserves from
		// the initial bundle. Production builds emit per-block dep
		// functions for code-splitting; in dev everything is already
		// loaded, so the runtime no-op is correct.
		defer: { dependenciesFn: null, mode: 1 },
		declarationListEmitMode: declarations.length > 0 ? 1 : 0,
		styles,
		encapsulation: decoratorMeta.encapsulation,
		animations: advancedMetadata.animations,
		viewProviders: advancedMetadata.viewProviders,
		relativeContextFilePath: projectRelPath,
		i18nUseExternalIds: projectDefaults.i18nUseExternalIds ?? false,
		changeDetection: decoratorMeta.changeDetection,
		relativeTemplatePath: null,
		hasDirectiveDependencies: declarations.length > 0
	};

	let compiled: R3CompiledExpression;
	try {
		const pool = new compiler.ConstantPool();
		const bindingParser = compiler.makeBindingParser();
		// The R3ComponentMetadata type is internal-shaped enough that
		// recreating it from public exports trips the compiler — we
		// know the runtime contract. Cast at the boundary.
		compiled = compiler.compileComponentFromMetadata(
			meta as unknown as Parameters<
				typeof compiler.compileComponentFromMetadata
			>[0],
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
		const fnText = printer.printNode(
			ts.EmitHint.Unspecified,
			exportedDecl,
			sourceFile
		);

		// Build the list of source-imported local names. The surgical
		// module destructures these from `${className}.__abs_deps`
		// (populated by `hmrInjectionPlugin`'s post-bundle registration
		// block), routing all symbol resolution through the live
		// bundle's references — vendor (rxjs, etc.) AND user-side
		// relative imports (services, composables) alike.
		//
		// Why __abs_deps for everything (instead of real `import`
		// statements):
		//   1. Identity sharing — the bundle's `AccountService`
		//      reference IS the same class Angular's injector tree was
		//      wired against. Re-fetching from `/@src/...` would yield
		//      a duplicate class with different identity, and DI would
		//      fail.
		//   2. No vendor-URL plumbing — bare specifiers in real
		//      `import` statements would need rewriteImports + correct
		//      vendor maps for every package the user imports. Routing
		//      through `__abs_deps` skips the URL resolution entirely.
		//   3. Tier 0 / Tier 1a unification — both paths use the same
		//      `_Fresh` class body, so consistent symbol-resolution
		//      mechanism keeps them in sync.
		//
		// We filter to symbols actually referenced in the `_Fresh`
		// block to keep the destructure tight.
		const provisionalMethodsBlock =
			buildFreshClassMethodsBlock(classNode, className) ?? '';
		const referencedNames = new Set<string>();
		const identRe = /[A-Za-z_$][A-Za-z0-9_$]*/g;
		let idMatch: RegExpExecArray | null;
		while ((idMatch = identRe.exec(provisionalMethodsBlock)) !== null) {
			referencedNames.add(idMatch[0]);
		}

		// Source-defined names: imports AND top-level const/let/var/
		// function/class declarations. The bundle plugin registers all
		// of these on `${className}.__abs_deps` (see
		// `extractAllTopLevelNames` in `hmrInjectionPlugin.ts`), so we
		// can destructure any source-scope identifier that the
		// `_Fresh` body references — not just imports.
		//
		// Critical for module-local helpers like
		//   const square = (id) => `https://images.../${id}`;
		//   class TestimonialAvatarsComponent {
		//     avatars = [{ src: square('...'), ... }, ...];
		//   }
		// — `square` lives in module scope of the bundled file but
		// isn't imported. Without including it here, the surgical
		// module's `_Fresh.avatars` initializer crashes with
		// `square is not defined`.
		const sourceScopeNames = new Set<string>();
		for (const stmt of sourceFile.statements) {
			if (ts.isImportDeclaration(stmt)) {
				if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
				const clause = stmt.importClause;
				if (clause?.name) sourceScopeNames.add(clause.name.text);
				if (
					clause?.namedBindings &&
					ts.isNamedImports(clause.namedBindings)
				) {
					for (const el of clause.namedBindings.elements) {
						if (el.isTypeOnly) continue;
						sourceScopeNames.add(el.name.text);
					}
				} else if (
					clause?.namedBindings &&
					ts.isNamespaceImport(clause.namedBindings)
				) {
					sourceScopeNames.add(clause.namedBindings.name.text);
				}
				continue;
			}
			if (
				ts.isVariableStatement(stmt) ||
				stmt.kind === ts.SyntaxKind.VariableStatement
			) {
				const varStmt = stmt as ts.VariableStatement;
				for (const decl of varStmt.declarationList.declarations) {
					if (ts.isIdentifier(decl.name)) {
						sourceScopeNames.add(decl.name.text);
					}
				}
				continue;
			}
			if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) {
				if (stmt.name) sourceScopeNames.add(stmt.name.text);
			}
		}
		// Don't destructure the class itself — it's already a
		// parameter of the surgical update function.
		sourceScopeNames.delete(className);

		// Imported component/directive identifiers are emitted in the
		// IR's `dependencies: () => [Foo, Bar]` closure. The scanner
		// above only checks the prototype-patch block, so it misses
		// those references. Add every resolved import to the
		// referencedNames set so they get destructured from
		// `__abs_deps` (where `hmrInjectionPlugin` already registers
		// them) and are in scope when the closure runs.
		for (const entry of resolvedImports) {
			referencedNames.add(entry.identifier.text);
		}

		// IR-emitted metadata can reference imported helpers that
		// don't appear in the prototype-patch block but DO appear
		// in the surgical `ɵɵdefineComponent({ inputs: { foo: [2,
		// 'foo', 'foo', booleanAttribute] } })` IR — most notably
		// `booleanAttribute` / `numberAttribute` for `@Input({
		// transform })`, `trigger` / `state` / `style` for
		// animations, and host-binding helpers. The scanner above
		// can't see those references because they live in the
		// IR-generated `ɵcmp` block, not in `_Fresh`. Including
		// every top-level imported name unconditionally adds ~1
		// destructure entry per import (cheap) and guarantees the
		// surgical scope has the symbols the IR may emit. Source-
		// scope const/function/class names are still gated by the
		// `_Fresh`-block scan above (those tend to be larger and
		// don't need broad inclusion).
		const allImportedNames = new Set<string>();
		for (const stmt of sourceFile.statements) {
			if (!ts.isImportDeclaration(stmt)) continue;
			const clause = stmt.importClause;
			if (!clause || clause.isTypeOnly) continue;
			if (clause.name) allImportedNames.add(clause.name.text);
			const bindings = clause.namedBindings;
			if (!bindings) continue;
			if (ts.isNamespaceImport(bindings)) {
				allImportedNames.add(bindings.name.text);
			} else {
				for (const el of bindings.elements) {
					if (el.isTypeOnly) continue;
					allImportedNames.add(el.name.text);
				}
			}
		}

		const depsToDestructure = [...sourceScopeNames].filter(
			(n) => referencedNames.has(n) || allImportedNames.has(n)
		);
		const tsSourceText = fnText;

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
		const methodsBlock = buildFreshClassMethodsBlock(classNode, className);
		let moduleText = transpiled;
		const fnOpening = `function ${className}_UpdateMetadata(${className}, ɵɵnamespaces) {`;
		const fnOpeningIdx = moduleText.indexOf(fnOpening);

		const depsDestructure =
			depsToDestructure.length > 0
				? `\n  const { ${depsToDestructure.join(', ')} } = ${className}.__abs_deps || {};\n`
				: '';

		if (fnOpeningIdx >= 0 && (methodsBlock || depsDestructure)) {
			const insertAt = fnOpeningIdx + fnOpening.length;
			moduleText =
				moduleText.slice(0, insertAt) +
				depsDestructure +
				(methodsBlock ? '\n' + methodsBlock + '\n' : '') +
				moduleText.slice(insertAt);
		}

		// Tier 1a tail. After the IR has set `${className}.ɵcmp` and
		// `${className}.ɵfac`, mirror the `_Fresh` class onto those
		// hooks too — sharing the def, but with a factory that
		// instantiates `_Fresh` (whose constructor runs the new field
		// initializers) rather than the live class. The function then
		// returns `_Fresh` so the client-side remount path can pass
		// it to `createComponent` for fresh-instance rendering.
		//
		// `_Fresh.ɵfac = () => new _Fresh()` is correct for
		// standalone components without explicit constructor params
		// (modern Angular pattern: `inject()` in field initializers).
		// For components with constructor DI args, this needs to
		// mirror the live factory's parameter passing — flagged as
		// a known limitation.
		if (methodsBlock) {
			// Clone the live class's def so `_Fresh.ɵcmp.type` and
			// `_Fresh.ɵcmp.factory` point at `_Fresh` — Angular's
			// `createComponent` reads `def.type` to decide which class
			// to instantiate, and `def.factory` is the actual factory
			// it invokes. Without overriding both, sharing the def
			// would route createComponent back to the live class's
			// factory and we'd get a `new HeroComponent()` (no new
			// fields) instead of `new _Fresh()`.
			//
			// The factory we install delegates to the LIVE class's
			// factory with `_Fresh` as the type override. The Angular-
			// generated factory looks like
			// `function(t) { return new (t || Class)(inject(Dep1),
			// inject(Dep2)); }` — passing `t = _Fresh` redirects the
			// `new` to `_Fresh` while preserving the bundle's
			// resolved DI args. This means components with explicit
			// constructor parameters (`constructor(private foo:
			// FooService)`) work end-to-end on Tier 1a — `foo` is
			// inject()'d at the right Angular runtime layer, with the
			// LIVE class identity Angular's injector tree was wired
			// against.
			//
			// We share most of the def via spread (template fn,
			// directiveDefs, pipeDefs, encapsulation, etc.) — those
			// are identity-stable across the swap. We DO blow away
			// `tView` (lazy cache) because the new factory means
			// Angular will create a fresh tView for `_Fresh` anyway,
			// and a stale tView with the wrong type embedded would
			// confuse the LView walks.
			const tail = `
  if (typeof _Fresh !== 'undefined') {
    var __abs_liveFac = ${className}.ɵfac;
    var __abs_freshFac = typeof __abs_liveFac === 'function'
      ? function(t) { return __abs_liveFac(t || _Fresh); }
      : function() { return new _Fresh(); };
    _Fresh.ɵcmp = Object.assign(
      Object.create(Object.getPrototypeOf(${className}.ɵcmp)),
      ${className}.ɵcmp,
      {
        type: _Fresh,
        factory: __abs_freshFac,
        tView: null
      }
    );
    _Fresh.ɵfac = __abs_freshFac;
    return _Fresh;
  }
`;
			// Inject before the function's closing `}`. The function
			// is the file's last expression, so its closing brace is
			// the last `}` in the module text.
			const lastBrace = moduleText.lastIndexOf('}');
			if (lastBrace >= 0) {
				moduleText =
					moduleText.slice(0, lastBrace) +
					tail +
					moduleText.slice(lastBrace);
			}
		}

		// Compile succeeded — seed/refresh the fingerprint cache with
		// the just-applied structure. Next call's fingerprint diff
		// compares against this baseline.
		fingerprintCache.set(fingerprintId, currentFingerprint);

		// Stash the just-built module text so the `/@ng/component`
		// endpoint can serve it without re-running the full pipeline.
		// See `pendingModuleCache` rationale at module top.
		setPendingModule(fingerprintId, moduleText);

		return {
			componentSource: sourceFile,
			fingerprintChanged,
			moduleText,
			ok: true,
			rebootstrapRequired
		};
	} catch (err) {
		return fail('unexpected-error', String(err));
	}
};
