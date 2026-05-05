/* Vendored LView slot operations. Direct port from
 * `@angular/core/fesm2022/_debug_node-chunk.mjs` of the small-and-pure
 * helpers we need for per-component remount. The big helpers
 * (renderView / refreshView / destroyLView's full DOM-removal path)
 * stay in Angular — we invoke them indirectly via public
 * `createComponent`. The ones here are slot-manipulation primitives
 * with no transitive dependencies, so vendoring them is safe.
 *
 * Per-Angular-version chore: re-diff against the upstream functions
 * after each minor bump. They've been stable since v17 — the algorithm
 * shape hasn't changed since the LView FLAGS reshuffle. */

import {
	CHILD_HEAD,
	CHILD_TAIL,
	CLEANUP,
	FLAGS,
	HEADER_OFFSET,
	LFLAG_DESTROYED,
	NEXT,
	ON_DESTROY_HOOKS,
	TVIEW
} from './slotConstants';

export type LView = unknown[];
export type LContainer = unknown[];
export type TView = {
	bindingStartIndex: number;
	cleanup: unknown[] | null;
	destroyHooks: unknown[] | null;
};
export type TNode = { index: number };

/* `isLView` / `isLContainer` shape checks. The runtime distinguishes
 * by whether slot 1 (TVIEW) is an object or undefined — LContainer
 * doesn't have a TView. */
export const isLView = (v: unknown): v is LView =>
	Array.isArray(v) && typeof (v as unknown[])[TVIEW] === 'object';

export const isLContainer = (v: unknown): v is LContainer =>
	Array.isArray(v) && (v as unknown[])[TVIEW] === undefined;

export const isDestroyed = (lView: LView): boolean =>
	((lView[FLAGS] as number) & LFLAG_DESTROYED) !== 0;

/* Vendored from `replaceLViewInTree(parentLView, oldLView, newLView, index)`.
 * Walks parent's slots looking for the LView/LContainer whose NEXT
 * pointer is `oldLView` and rewires it to `newLView`, then patches
 * CHILD_HEAD / CHILD_TAIL if `oldLView` was at either end, and finally
 * places `newLView` at the indexed slot.
 *
 * Verbatim port — keep it that way to make diff-against-upstream cheap. */
export const replaceLViewInTree = (
	parentLView: LView,
	oldLView: LView,
	newLView: LView,
	index: number
): void => {
	const parentTView = parentLView[TVIEW] as TView;
	for (let i = HEADER_OFFSET; i < parentTView.bindingStartIndex; i++) {
		const current = parentLView[i];
		if (
			(isLView(current) || isLContainer(current)) &&
			(current as LView)[NEXT] === oldLView
		) {
			(current as LView)[NEXT] = newLView;
			break;
		}
	}
	if (parentLView[CHILD_HEAD] === oldLView) parentLView[CHILD_HEAD] = newLView;
	if (parentLView[CHILD_TAIL] === oldLView) parentLView[CHILD_TAIL] = newLView;
	newLView[NEXT] = oldLView[NEXT];
	oldLView[NEXT] = null;
	parentLView[index] = newLView;
};

/* Vendored from `executeOnDestroys(tView, lView)`. tView.destroyHooks
 * is laid out as `[slotIdx, hook | hookList, slotIdx, hook | hookList, ...]`.
 * Each `hook` is either a function (called with `lView[slotIdx]` as
 * `this`) or an array of `[propertyKey, fn]` pairs (one per directive
 * sharing the slot). NodeInjectorFactory contexts are skipped; they
 * represent injector providers, not directive instances. */
type NodeInjectorFactoryLike = { multi?: unknown };

const isNodeInjectorFactoryLike = (
	value: unknown
): value is NodeInjectorFactoryLike =>
	typeof value === 'object' &&
	value !== null &&
	value.constructor !== undefined &&
	value.constructor.name === 'NodeInjectorFactory';

export const executeOnDestroys = (tView: TView, lView: LView): void => {
	const destroyHooks = tView.destroyHooks;
	if (destroyHooks == null) return;

	for (let i = 0; i < destroyHooks.length; i += 2) {
		const slotIdx = destroyHooks[i] as number;
		const context = lView[slotIdx];
		if (isNodeInjectorFactoryLike(context)) continue;

		const toCall = destroyHooks[i + 1];
		if (Array.isArray(toCall)) {
			for (let j = 0; j < toCall.length; j += 2) {
				const propKey = toCall[j] as string;
				const hook = toCall[j + 1] as () => void;
				const callContext = (context as Record<string, unknown>)[propKey];
				try {
					hook.call(callContext);
				} catch (err) {
					console.error('[absolutejs] onDestroy hook threw', err);
				}
			}
		} else if (typeof toCall === 'function') {
			try {
				(toCall as (this: unknown) => void).call(context);
			} catch (err) {
				console.error('[absolutejs] onDestroy hook threw', err);
			}
		}
	}
};

/* Vendored from `processCleanups(tView, lView)`. Walks tView.cleanup which
 * is laid out as either:
 *   [eventName(string), targetIdx, listenerIdx, indirectIdx, ...]
 *     — DOM event listener; lCleanup[indirectIdx] is the unregister fn
 *       (or, if indirectIdx is negative, lCleanup[-indirectIdx] is a
 *       Subscription whose .unsubscribe() we call)
 *   [hookFn(function), contextSlotIdx, ...]
 *     — directive output / cleanup callback; call hookFn with
 *       lCleanup[contextSlotIdx] as `this`
 * Then walks lView[ON_DESTROY_HOOKS] (component-level destroy hooks,
 * registered via `inject(DestroyRef).onDestroy(...)` etc.) and fires
 * each one. */
export const processCleanups = (tView: TView, lView: LView): void => {
	const tCleanup = tView.cleanup;
	const lCleanup = lView[CLEANUP] as unknown[] | null;

	if (tCleanup !== null && lCleanup !== null) {
		for (let i = 0; i < tCleanup.length - 1; i += 2) {
			const entry = tCleanup[i];
			if (typeof entry === 'string') {
				const targetIdx = tCleanup[i + 3] as number;
				try {
					if (targetIdx >= 0) {
						(lCleanup[targetIdx] as () => void)();
					} else {
						(
							lCleanup[-targetIdx] as { unsubscribe: () => void }
						).unsubscribe();
					}
				} catch (err) {
					console.error('[absolutejs] DOM cleanup threw', err);
				}
				i += 2;
			} else if (typeof entry === 'function') {
				const ctxIdx = tCleanup[i + 1] as number;
				try {
					(entry as (this: unknown) => void).call(lCleanup[ctxIdx]);
				} catch (err) {
					console.error('[absolutejs] cleanup callback threw', err);
				}
			}
		}
	}

	if (lCleanup !== null) {
		lView[CLEANUP] = null;
	}

	const onDestroyHooks = lView[ON_DESTROY_HOOKS] as
		| Array<() => void>
		| null;
	if (onDestroyHooks !== null) {
		lView[ON_DESTROY_HOOKS] = null;
		for (const hook of onDestroyHooks) {
			try {
				hook();
			} catch (err) {
				console.error('[absolutejs] DestroyRef hook threw', err);
			}
		}
	}
};

/* Mark an LView as destroyed so any later
 * destroyLView/cleanUpView no-ops it. Without this flag the LView
 * could get walked twice (e.g. if Angular's tree-walk later finds
 * a stale reference). */
export const markLViewDestroyed = (lView: LView): void => {
	lView[FLAGS] = ((lView[FLAGS] as number) | LFLAG_DESTROYED) >>> 0;
};
