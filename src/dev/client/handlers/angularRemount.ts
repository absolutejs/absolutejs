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
 * Caveats baked into this approach:
 *   • Old @Input bindings from the parent are NOT re-applied. The
 *     parent's template flow runs at parent-CD time and wires inputs
 *     then; until then the new instance sees default values. In
 *     practice this matches Tier 1 rebootstrap behavior — no worse.
 *   • Old projection content (ng-content) doesn't transfer. If the
 *     parent injected a child via ng-content, the new instance has an
 *     empty projection slot until parent re-renders.
 *   • Class field initializers (e.g. `private foo = inject(Bar)`) are
 *     baked into the original class's compiled constructor at bundle
 *     time. The surgical update patches `Class.ɵcmp` and prototype
 *     methods, but does NOT replace the class itself — so a NEW field
 *     added in source after the initial bundle won't appear on the
 *     fresh instance. Method-body / decorator / provider / template
 *     changes DO take effect (they live on the def, not the
 *     constructor). To pick up new field initializers requires a
 *     class-level rewrite or escalation to Tier 1b rebootstrap. */

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

/* Walk the DOM looking for elements whose component instance is of
 * `Class`. Each match resolves to its parent LView + slot index via
 * the LContext stored on the host element under `__ngContext__`.
 *
 * We walk DOM (not Angular's TRACKED_LVIEWS map) because (a)
 * TRACKED_LVIEWS isn't exported and (b) the DOM walk is bounded by
 * page size, which is fast enough for HMR. */
const findLiveInstances = (Class: ComponentClass): LiveInstance[] => {
	const results: LiveInstance[] = [];
	const elements = document.querySelectorAll('*');
	for (const el of Array.from(elements)) {
		const ctx = (el as unknown as Record<string, unknown>).__ngContext__;
		if (typeof ctx !== 'object' || ctx === null) continue;
		const lContext = ctx as { lView?: LView; nodeIndex?: number };
		if (!lContext.lView || lContext.nodeIndex === undefined) continue;

		const slot = lContext.lView[lContext.nodeIndex];
		if (!isLView(slot)) continue;
		const ownLView = slot as LView;
		const instance = ownLView[CONTEXT];
		if (!(instance instanceof Class)) continue;

		const tNode = ownLView[T_HOST] as TNode | null;
		const host = ownLView[HOST] as Element | null;
		if (!tNode || !host) continue;

		// Avoid double-recording the same LView (multiple DOM elements
		// can land in the same component, all sharing __ngContext__)
		if (results.some((r) => r.oldLView === ownLView)) continue;

		results.push({
			host,
			oldLView: ownLView,
			parentLView: lContext.lView,
			slotIndex: lContext.nodeIndex,
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
	const w = window as unknown as {
		__ANGULAR_APP__?: { injector: unknown };
	};
	const envInjector = w.__ANGULAR_APP__?.injector;
	if (!envInjector) return null;

	const ref = core.createComponent(Class, {
		hostElement,
		environmentInjector: envInjector
	});

	const newLView = ref.hostView._lView;
	if (!newLView) {
		// Should never happen — _lView is always populated by Angular's
		// internal createComponent path. If it is missing, our slot
		// constants might be off; bail to caller for fallback.
		ref.destroy();
		return null;
	}

	return { instance: ref.instance, newLView, componentRef: ref };
};

/* Splice `newLView` into `parentLView` at `slotIndex`, replacing
 * `oldLView`. After the splice, the new LView lives in the parent's
 * view tree; the old one is detached. */
const spliceLViewIntoParent = (
	target: LiveInstance,
	newLView: LView
): void => {
	const { parentLView, oldLView, slotIndex, tNode } = target;
	replaceLViewInTree(parentLView, oldLView, newLView, slotIndex);
	newLView[PARENT] = parentLView;
	newLView[T_HOST] = tNode;
};

/* Fire onDestroy + cleanup on the OLD LView so subscriptions, event
 * listeners, and `inject(DestroyRef).onDestroy(...)` callbacks all
 * fire. Then mark the LView as destroyed so any subsequent
 * tree-walk skips it. */
const teardownOldLView = (oldLView: LView): void => {
	const oldTView = oldLView[TVIEW] as TView | null;
	if (oldTView) {
		executeOnDestroys(oldTView, oldLView);
		processCleanups(oldTView, oldLView);
	}
	markLViewDestroyed(oldLView);
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
	) => void,
	namespaces: unknown[],
	locals: unknown[],
	core: AngularCoreNamespace,
	className: string
): Promise<RemountResult> => {
	try {
		applyMetadata.apply(null, [Class, namespaces, ...locals]);
	} catch (err) {
		return {
			className,
			error: `applyMetadata threw: ${(err as Error).message}`,
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
			const fresh = createFreshAt(Class, target.host, core);
			if (!fresh) {
				skipped++;
				continue;
			}

			spliceLViewIntoParent(target, fresh.newLView);
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

	return { className, remounted, skipped };
};
