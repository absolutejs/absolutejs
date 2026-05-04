/* Edit-type classification for Angular HMR fast paths.
 *
 * The dev server classifies each changed Angular file into one of the
 * union members below so the client can dispatch to the cheapest
 * correctness-preserving update strategy. Stubs in the client default
 * to "fall through to reboot", so adding new fast paths is a matter of
 * implementing the corresponding client-side handler — no changes here
 * are needed unless the *detection* itself is wrong.
 *
 * Detection layers (cheap → expensive):
 *   1. Filename patterns: `.html`, `.component.css`, `.routes.ts`, etc.
 *   2. AST scan via TypeScript's compiler API for service files — only
 *      runs on `*.service.ts` edits, never on hot template/style paths.
 *
 * Why AST for services and not regex: the dangerous failure direction
 * is a false-negative ("constructor has no side effects" → method-swap
 * fast path → silently leaks the old constructor's subscription onto
 * the new instance). Regex misses delegated calls
 * (`constructor() { this.init() }` where `init()` subscribes), and
 * splits on multiline `.pipe(...).subscribe(...)`. AST gives us the
 * call graph for free at ~2-5ms cold / sub-ms warm — invisible
 * compared to the 50-200ms HMR end-to-end budget. */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as ts from 'typescript';

export type AngularEditType =
	| 'template'
	| 'style-component'
	| 'class-component'
	| 'service-method-only'
	| 'service-with-side-effects'
	| 'route'
	| 'reboot';

export type AngularEditClassification = {
	type: AngularEditType;
	reason: string;
	sourceFile: string;
};

/* Priority ordering for collapsing a multi-file edit batch into a
 * single classification. Higher index wins — e.g. a batch containing
 * a template edit AND a routes.ts edit must be classified as `route`
 * because the router can't be hot-swapped. */
const TYPE_PRIORITY: Record<AngularEditType, number> = {
	template: 0,
	'style-component': 1,
	'service-method-only': 2,
	'class-component': 3,
	'service-with-side-effects': 4,
	route: 5,
	reboot: 6
};

const STYLE_EXT_RE = /\.(css|scss|sass|less|styl|stylus|pcss|postcss)$/i;
const COMPONENT_STYLE_RE =
	/\.component\.(css|scss|sass|less|styl|stylus|pcss|postcss)$/i;
const TEMPLATE_RE = /\.html$/i;
const COMPONENT_CLASS_RE = /\.component\.ts$/i;
const SERVICE_RE = /\.service\.ts$/i;
const ROUTES_RE = /(?:^|[\\/])(?:app\.)?routes\.ts$/i;
/* Page entries in `<angularDir>/pages/` are component classes whose
 * filename convention drops the `.component` suffix
 * (e.g. `pages/profile.ts` exports `ProfileComponent`). They behave
 * identically to component classes for HMR purposes — fast-patch via
 * prototype swap is the right default. */
const PAGE_TS_RE = /(?:^|[\\/])pages[\\/][^\\/]+\.ts$/i;

/* Names whose invocation in a constructor (transitively) means we can
 * not safely swap a method without leaking the prior subscription /
 * timer / listener. Over-rejection here is cheap (we just reboot,
 * which still works); under-rejection silently corrupts state. */
const SIDE_EFFECT_CALL_NAMES = new Set([
	'subscribe',
	'setInterval',
	'setTimeout',
	'addEventListener',
	'effect',
	'afterNextRender',
	'afterRender',
	'afterEveryRender',
	'requestAnimationFrame',
	'requestIdleCallback'
]);

const SIDE_EFFECT_NEW_NAMES = new Set([
	'Worker',
	'SharedWorker',
	'EventSource',
	'WebSocket',
	'BroadcastChannel'
]);

const getCalleeName = (node: ts.CallExpression): string | null => {
	const callee = node.expression;
	if (ts.isIdentifier(callee)) return callee.text;
	if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
	return null;
};

const getNewExprName = (node: ts.NewExpression): string | null => {
	const callee = node.expression;
	if (ts.isIdentifier(callee)) return callee.text;
	if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
	return null;
};

type MethodTable = Map<string, ts.Node>;

const collectMethodBodies = (cls: ts.ClassDeclaration): MethodTable => {
	const methods: MethodTable = new Map();
	cls.members.forEach((member) => {
		if (!member.name || !ts.isIdentifier(member.name)) return;
		if (ts.isMethodDeclaration(member) && member.body) {
			methods.set(member.name.text, member.body);
			return;
		}
		if (ts.isPropertyDeclaration(member) && member.initializer) {
			const init = member.initializer;
			if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
				methods.set(member.name.text, init.body);
			}
		}
	});
	return methods;
};

type SideEffectResult = { found: true; reason: string } | { found: false };

const findSideEffectInBody = (
	body: ts.Node,
	methods: MethodTable,
	visited: Set<string>
): SideEffectResult => {
	let hit: SideEffectResult = { found: false };

	const walk = (node: ts.Node): void => {
		if (hit.found) return;

		if (ts.isCallExpression(node)) {
			const name = getCalleeName(node);
			if (name && SIDE_EFFECT_CALL_NAMES.has(name)) {
				hit = {
					found: true,
					reason: `constructor invokes ${name}(...)`
				};
				return;
			}
			if (name && methods.has(name) && !visited.has(name)) {
				visited.add(name);
				const target = methods.get(name);
				if (target) {
					const inner = findSideEffectInBody(
						target,
						methods,
						visited
					);
					if (inner.found) {
						hit = {
							found: true,
							reason: `${inner.reason} (via this.${name}())`
						};
						return;
					}
				}
			}
		}

		if (ts.isNewExpression(node)) {
			const name = getNewExprName(node);
			if (name && SIDE_EFFECT_NEW_NAMES.has(name)) {
				hit = {
					found: true,
					reason: `constructor instantiates new ${name}(...)`
				};
				return;
			}
		}

		ts.forEachChild(node, walk);
	};

	walk(body);
	return hit;
};

const analyzeServiceFile = (
	file: string
): { hasSideEffectCtor: boolean; reason: string } => {
	let source: string;
	try {
		source = readFileSync(file, 'utf8');
	} catch {
		return {
			hasSideEffectCtor: true,
			reason: 'service file unreadable — defaulting to reboot'
		};
	}

	const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

	let result: { hasSideEffectCtor: boolean; reason: string } = {
		hasSideEffectCtor: false,
		reason: 'constructor has no side-effecting calls'
	};

	const visit = (node: ts.Node): void => {
		if (result.hasSideEffectCtor) return;
		if (!ts.isClassDeclaration(node)) {
			ts.forEachChild(node, visit);
			return;
		}

		const methods = collectMethodBodies(node);
		const ctor = node.members.find(ts.isConstructorDeclaration);
		const targets: ts.Node[] = [];
		if (ctor?.body) targets.push(ctor.body);
		// Field initializers fire when `new Service()` runs, so they're
		// part of the construction-time side-effect surface.
		node.members.forEach((member) => {
			if (ts.isPropertyDeclaration(member) && member.initializer) {
				targets.push(member.initializer);
			}
		});

		for (const target of targets) {
			const r = findSideEffectInBody(target, methods, new Set());
			if (r.found) {
				result = { hasSideEffectCtor: true, reason: r.reason };
				break;
			}
		}

		if (!result.hasSideEffectCtor) ts.forEachChild(node, visit);
	};

	visit(sf);
	return result;
};

export const classifyAngularEdit = (
	file: string
): AngularEditClassification => {
	const base = basename(file);

	if (TEMPLATE_RE.test(file)) {
		return {
			type: 'template',
			reason: `${base} — template edit`,
			sourceFile: file
		};
	}

	if (COMPONENT_STYLE_RE.test(file)) {
		return {
			type: 'style-component',
			reason: `${base} — component-scoped stylesheet edit`,
			sourceFile: file
		};
	}

	// A plain `.css` next to a `.component.ts` (without the `.component`
	// in the filename) still scopes to that component. Treat any styles
	// that aren't matched by the COMPONENT_STYLE_RE — and aren't global
	// stylesheets — as `style-component` if a sibling .component.ts is
	// likely the importer. We can't read the file system here without
	// expense; for now route bare-style edits to reboot rather than
	// risk a wrong scoping path. Tightening this is a Phase-2 follow-up
	// once we have the dependency graph integrated.
	if (STYLE_EXT_RE.test(file)) {
		return {
			type: 'reboot',
			reason: `${base} — non-component-named stylesheet, falling back to reboot until scoping is verified`,
			sourceFile: file
		};
	}

	if (ROUTES_RE.test(file)) {
		return {
			type: 'route',
			reason: `${base} — router config, requires reboot`,
			sourceFile: file
		};
	}

	if (SERVICE_RE.test(file)) {
		const a = analyzeServiceFile(file);
		if (a.hasSideEffectCtor) {
			return {
				type: 'service-with-side-effects',
				reason: `${base} — ${a.reason}`,
				sourceFile: file
			};
		}
		return {
			type: 'service-method-only',
			reason: `${base} — ${a.reason}`,
			sourceFile: file
		};
	}

	if (COMPONENT_CLASS_RE.test(file)) {
		return {
			type: 'class-component',
			reason: `${base} — component class edit`,
			sourceFile: file
		};
	}

	if (PAGE_TS_RE.test(file)) {
		return {
			type: 'class-component',
			reason: `${base} — page component edit`,
			sourceFile: file
		};
	}

	return {
		type: 'reboot',
		reason: `${base} — unrecognized angular file type, falling back to reboot`,
		sourceFile: file
	};
};

/* Collapse a batch of single-file classifications to one verdict for a
 * given page broadcast. Picks the highest-priority (most-restrictive)
 * type so a batch containing both a template edit and a routes change
 * correctly classifies as `route`. */
export const collapseClassifications = (
	classifications: AngularEditClassification[]
): AngularEditClassification => {
	if (classifications.length === 0) {
		return {
			type: 'reboot',
			reason: 'no classifiable files in batch',
			sourceFile: ''
		};
	}

	let winner = classifications[0]!;
	for (let i = 1; i < classifications.length; i++) {
		const candidate = classifications[i]!;
		if (TYPE_PRIORITY[candidate.type] > TYPE_PRIORITY[winner.type]) {
			winner = candidate;
		}
	}
	return winner;
};
