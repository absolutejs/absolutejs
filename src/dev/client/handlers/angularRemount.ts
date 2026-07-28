/* Per-component Tier 1 remount.
 *
 * When fastHmr reports a structural change for a component class,
 * full app rebootstrap loses all sibling component state. Instead, we
 * remount only the affected components: destroy each live instance +
 * recreate at the same DOM host with the new factory.
 *
 * This uses public `createComponent` for the heavy lifting (it runs
 * the new constructor, sets up DI, fires lifecycle hooks, renders the
 * template, attaches change detection). We supplement with vendored
 * LView slot manipulation to (a) find each live instance's parent
 * LView slot and (b) splice the freshly-created LView into that slot
 * so it participates in the parent's view tree instead of being a
 * detached root.
 *
 * Lifecycle of one remount:
 *   1. `applyMetadata` runs, returning `_Fresh` — a class with the
 *      full new body (fields + ctor + methods) and a `ɵfac` that
 *      delegates to the LIVE class's factory with `_Fresh` as the
 *      type override. The delegation preserves the bundle's resolved
 *      DI for explicit constructor params.
 *   2. For each live instance: `createComponent(_Fresh, hostElement)`
 *      builds a fresh `ComponentRef` at the same host. Angular runs
 *      the new constructor (firing field initializers + lifecycle
 *      hooks) and renders the new template.
 *   3. Splice the new LView into the parent's slot via vendored slot
 *      ops, replacing the old one in the parent's view tree.
 *   4. Tear down the old LView (`executeOnDestroys` +
 *      `processCleanups`) so RxJS subscriptions, DOM event listeners,
 *      and `inject(DestroyRef).onDestroy(...)` callbacks all fire.
 *   5. `ApplicationRef.tick()` so the parent's template re-runs
 *      against the new slot — re-applies `@Input` bindings and
 *      re-projects `<ng-content>` into the fresh child. */

import {
	CONTEXT,
	HOST,
	PARENT,
	T_HOST,
	TVIEW
} from '../vendor/lview/slotConstants';
import {
	executeOnDestroys,
	isLView,
	markLViewDestroyed,
	processCleanups,
	replaceLViewInTree,
	type LView,
	type TView,
	type TNode
} from '../vendor/lview/lViewOps';

type AngularCoreNamespace = {
	createComponent: (
		type: unknown,
		options: {
			hostElement?: Element;
			environmentInjector: unknown;
		}
	) => {
		instance: unknown;
		hostView: { _lView?: LView; detectChanges?: () => void };
		destroy: () => void;
	};
	ApplicationRef?: unknown;
};

type ComponentClass = new (...args: unknown[]) => unknown;

type LiveInstance = {
	host: Element;
	oldLView: LView;
	parentLView: LView;
	slotIndex: number;
	tNode: TNode;
};

const isComponentClass = (value: unknown): value is ComponentClass =>
	typeof value === 'function';

const isTNode = (value: unknown): value is TNode =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'index') === 'number';

const isTView = (value: unknown): value is TView =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'bindingStartIndex') === 'number';

/* Walk the DOM looking for elements whose component instance is of
 * `Class`. Each match resolves to its parent LView + slot index via
 * the LContext stored on the host element under `__ngContext__`.
 *
 * We walk DOM (not Angular's TRACKED_LVIEWS map) because (a)
 * TRACKED_LVIEWS isn't exported and (b) the DOM walk is bounded by
 * page size, which is fast enough for HMR. */
const findLiveInstances = (Class: ComponentClass) => {
	const results: LiveInstance[] = [];
	const elements = document.querySelectorAll('*');
	for (const element of Array.from(elements)) {
		const ctx = Reflect.get(element, '__ngContext__');
		if (typeof ctx !== 'object' || ctx === null) continue;
		const lView = Reflect.get(ctx, 'lView');
		const nodeIndex = Reflect.get(ctx, 'nodeIndex');
		if (!isLView(lView) || typeof nodeIndex !== 'number') continue;

		const slot = lView[nodeIndex];
		if (!isLView(slot)) continue;
		const instance = slot[CONTEXT];
		if (!(instance instanceof Class)) continue;

		const tNode = slot[T_HOST];
		const host = slot[HOST];
		if (!isTNode(tNode) || !(host instanceof Element)) continue;

		// Avoid double-recording the same LView (multiple DOM elements
		// can land in the same component, all sharing __ngContext__)
		if (results.some((result) => result.oldLView === slot)) continue;

		results.push({
			host,
			oldLView: slot,
			parentLView: lView,
			slotIndex: nodeIndex,
			tNode
		});
	}

	return results;
};

/* Run a public `createComponent` call to instantiate `Class` at
 * `hostElement`. Pulls ApplicationRef + EnvironmentInjector through
 * the live app's injector exposed on `window.__ANGULAR_APP__`. */
const createFreshAt = (
	Class: ComponentClass,
	hostElement: Element,
	core: AngularCoreNamespace
): {
	instance: unknown;
	newLView: LView;
	componentRef: ReturnType<AngularCoreNamespace['createComponent']>;
} | null => {
	const envInjector = window.__ANGULAR_APP__
		? Reflect.get(window.__ANGULAR_APP__, 'injector')
		: undefined;
	if (!envInjector) return null;

	const ref = core.createComponent(Class, {
		environmentInjector: envInjector,
		hostElement
	});

	const newLView = ref.hostView._lView;
	if (!newLView) {
		// Should never happen — _lView is always populated by Angular's
		// internal createComponent path. If it is missing, our slot
		// constants might be off; bail to caller for fallback.
		ref.destroy();

		return null;
	}

	return { componentRef: ref, instance: ref.instance, newLView };
};

/* Splice `newLView` into `parentLView` at `slotIndex`, replacing
 * `oldLView`. After the splice, the new LView lives in the parent's
 * view tree; the old one is detached.
 *
 * ALSO rewires the directive-instance slots in `parentLView` for
 * this node from the OLD instance to the NEW one. Angular stores
 * each directive instance at `parentLView[i]` for `i` in
 * `[tNode.directiveStart, tNode.directiveEnd)`. Parent template
 * binding ops like `ɵɵproperty('priority', value)` walk that range
 * and write to `parentLView[i].priority` — if those slots still
 * point at the OLD instance, parent CD writes to a dead reference
 * and `@Input` bindings never make it to the new instance. */
const spliceLViewIntoParent = (
	target: LiveInstance,
	newLView: LView,
	newInstance: unknown
) => {
	const { parentLView, oldLView, slotIndex, tNode } = target;
	replaceLViewInTree(parentLView, oldLView, newLView, slotIndex);
	newLView[PARENT] = parentLView;
	newLView[T_HOST] = tNode;

	const oldInstance = oldLView[CONTEXT];
	const start = Reflect.get(tNode, 'directiveStart');
	const end = Reflect.get(tNode, 'directiveEnd');
	if (typeof start === 'number' && typeof end === 'number') {
		for (let index = start; index < end; index++) {
			if (parentLView[index] === oldInstance) {
				parentLView[index] = newInstance;
			}
		}
	}
};

/* Fire onDestroy + cleanup on the OLD LView so subscriptions, event
 * listeners, and `inject(DestroyRef).onDestroy(...)` callbacks all
 * fire. Then mark the LView as destroyed so any subsequent
 * tree-walk skips it. */
const teardownOldLView = (oldLView: LView) => {
	const oldTView = oldLView[TVIEW];
	if (isTView(oldTView)) {
		executeOnDestroys(oldTView, oldLView);
		processCleanups(oldTView, oldLView);
	}
	markLViewDestroyed(oldLView);
};

/* Copy `@Input` field values from the OLD instance to the NEW one.
 *
 * This is needed because Angular's parent template emits binding ops
 * like `ɵɵproperty('priority', true)` that compare against a cached
 * binding slot in the parent's LView before writing. After our
 * splice the CACHED value is unchanged (the parent's LView wasn't
 * re-rendered), so the next parent CD sees `true === true (cached)`
 * and SKIPS the write. The new instance's `priority` would stay at
 * its default until the parent's binding expression result changes.
 *
 * Pre-seeding the new instance with the old value sidesteps this:
 * by the time the parent's binding op might run, the new instance
 * already has the correct value, and any future change will fire
 * normally because the binding-cache invariant is preserved.
 *
 * `def.inputs` metadata format (modern Angular):
 *   - `{ propName: 'classFieldName' }` (simple alias)
 *   - `{ propName: ['publicName', 'classFieldName', transformFn?] }` */
const copyInputsFromOldToNew = (oldInstance: unknown, newInstance: unknown) => {
	if (!oldInstance || !newInstance) return;
	if (
		(typeof oldInstance !== 'object' &&
			typeof oldInstance !== 'function') ||
		(typeof newInstance !== 'object' && typeof newInstance !== 'function')
	) {
		return;
	}
	const constructor = Reflect.get(newInstance, 'constructor');
	const definition =
		typeof constructor === 'function'
			? Reflect.get(constructor, 'ɵcmp')
			: undefined;
	if (typeof definition !== 'object' || definition === null) return;
	const inputs = Reflect.get(definition, 'inputs');
	if (typeof inputs !== 'object' || inputs === null) return;

	// Modern Angular inputs format (since v17ish): the OBJECT KEY is
	// the class property name; the value is either a string (binding
	// name) or `[bindingName, flags, transformFn?]`. So the class
	// field name is just `Object.keys(inputs)`.
	for (const classField of Object.keys(inputs)) {
		if (classField in oldInstance) {
			Reflect.set(
				newInstance,
				classField,
				Reflect.get(oldInstance, classField)
			);
		}
	}
};

export type RemountResult = {
	className: string;
	remounted: number;
	skipped: number;
	error?: string;
};

/* Public entry. Called by the bundle's HMR listener block when an
 * `angular:component-remount` event arrives for this class.
 *
 * applyMetadata is the surgical module's default export — it patches
 * `Class.ɵcmp` with the new component definition. We call it BEFORE
 * createComponent so the fresh instance picks up the new template,
 * dependencies, etc.
 *
 * locals + namespaces match `ɵɵreplaceMetadata`'s contract — passed
 * through to applyMetadata. We're not using ɵɵreplaceMetadata here
 * (it preserves instance state, defeating the point), but we mirror
 * the calling convention so bundle-level code stays consistent. */
export const remountComponentClass = async (
	Class: ComponentClass,
	applyMetadata: (
		Class: unknown,
		namespaces: unknown[],
		...locals: unknown[]
	) => unknown,
	namespaces: unknown[],
	locals: unknown[],
	core: AngularCoreNamespace,
	className: string
): Promise<RemountResult> => {
	let FreshClass = Class;
	try {
		// `applyMetadata` from a recent fastHmr build returns a `_Fresh`
		// class with the new constructor + field initializers + the
		// live class's `ɵcmp` re-bound. Older builds (or non-component
		// surgical paths) return undefined; in that case the live
		// class is used and `createComponent` will call its existing
		// factory — no field-initializer refresh, but template /
		// method patches still apply.
		const returned = applyMetadata.apply(null, [
			Class,
			namespaces,
			...locals
		]);
		if (isComponentClass(returned)) {
			FreshClass = returned;
		}
	} catch (err) {
		return {
			className,
			error: `applyMetadata threw: ${
				err instanceof Error ? err.message : String(err)
			}`,
			remounted: 0,
			skipped: 0
		};
	}

	const targets = findLiveInstances(Class);
	if (targets.length === 0) {
		return { className, remounted: 0, skipped: 0 };
	}

	let remounted = 0;
	let skipped = 0;

	for (const target of targets) {
		try {
			const fresh = createFreshAt(FreshClass, target.host, core);
			if (!fresh) {
				skipped++;
				continue;
			}

			copyInputsFromOldToNew(target.oldLView[CONTEXT], fresh.instance);
			spliceLViewIntoParent(target, fresh.newLView, fresh.instance);
			teardownOldLView(target.oldLView);

			fresh.componentRef.hostView.detectChanges?.();
			remounted++;
		} catch (err) {
			console.error(
				`[absolutejs] remount of ${className} failed at`,
				target.host,
				err
			);
			skipped++;
		}
	}

	if (remounted > 0) {
		// Trigger an app-wide CD pass so the parent's template re-runs
		// against the new child LView's slot. This is what re-applies
		// `@Input` bindings (`<app-hero [foo]="bar">`) and re-projects
		// `<ng-content>` content into the new instance — both are
		// PARENT-template artifacts that Angular only re-evaluates
		// during the parent's update pass, not during the child's
		// fresh creation. Without this tick, a remounted component
		// shows default field values until the user interacts and
		// triggers a stray CD elsewhere.
		try {
			window.__ANGULAR_APP__?.tick();
		} catch (err) {
			console.error(
				'[absolutejs] post-remount tick threw — partial state',
				err
			);
		}
	}

	return { className, remounted, skipped };
};
