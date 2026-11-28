import type {
	HoverPrefetchHandle,
	PrefetchKind,
	PrefetchMode
} from '../../types/prefetch';
import {
	isPrefetchableHref,
	observeViewport,
	prefetch,
	resolveDefaultPrefetchMode,
	scheduleHoverPrefetch,
	speculate
} from '../client/prefetch';

export type UsePrefetchOptions = {
	/** What to warm. Defaults to `'document'` for the viewport trigger and
	 *  `'route'` (document + route data + the modules / CSS it names) for
	 *  hover and pointerdown. */
	kind?: PrefetchKind;
	/** `'viewport'` (production default), `'hover'` (development default)
	 *  or `'none'`. */
	mode?: PrefetchMode;
	/** Also inject a prerender speculation rule when the hover /
	 *  pointerdown trigger fires. */
	prerender?: boolean;
};

/* What a Svelte action returns, written by hand: nothing here needs
 * Svelte's runtime or its types. */
type ActionReturn<Parameter> = {
	destroy: () => void;
	update: (parameter: Parameter) => void;
};

/**
 * Prefetching for any element, as a Svelte action — the counterpart of
 * React's and Vue's `usePrefetch`:
 *
 *   <script lang="ts">
 *     import { usePrefetch } from '@absolutejs/absolute/svelte';
 *
 *     const prefetch = usePrefetch({ mode: 'hover' });
 *   </script>
 *
 *   <a href="/pricing" use:prefetch>Pricing</a>
 *   <button use:prefetch={'/checkout'}>Buy</button>
 *
 * The address is the element's own `href`, or the action's parameter
 * when one is given, and follows either as it changes. It prefetches
 * when the element scrolls into view (`'viewport'`) and on hover, focus
 * and pointerdown, as `<Link>` does; this is for an element that is not
 * one.
 *
 * Cross-origin, hash-only and empty addresses are ignored, as is
 * everything when the visitor has data-saver on or the page set
 * `window.__ABSOLUTE_PREFETCH__ = false`.
 */
export const usePrefetch =
	(options: UsePrefetchOptions = {}) =>
	(node: HTMLElement, parameter?: string) => {
		const viewportKind = options.kind ?? 'document';
		const triggerKind = options.kind ?? 'route';
		let given = parameter;
		let hover: HoverPrefetchHandle | null = null;
		let stopObserving: (() => void) | undefined;

		const mode = () => options.mode ?? resolveDefaultPrefetchMode();
		const target = () => {
			const href = given ?? node.getAttribute('href') ?? undefined;

			return href !== undefined &&
				isPrefetchableHref(href) &&
				mode() !== 'none'
				? href
				: undefined;
		};

		const cancelHover = () => {
			hover?.cancel();
			hover = null;
		};
		const onEnter = () => {
			const href = target();
			if (href === undefined) return;
			cancelHover();
			hover = scheduleHoverPrefetch(href, {
				kind: triggerKind,
				prerender: options.prerender === true
			});
		};
		const onDown = () => {
			const href = target();
			if (href === undefined) return;
			cancelHover();
			prefetch(href, { kind: triggerKind });
			if (options.prerender === true) speculate(href);
		};

		const observe = () => {
			stopObserving?.();
			const href = target();
			stopObserving =
				href !== undefined && mode() === 'viewport'
					? observeViewport(node, href, { kind: viewportKind })
					: undefined;
		};

		node.addEventListener('pointerenter', onEnter);
		node.addEventListener('focus', onEnter);
		node.addEventListener('pointerdown', onDown);
		node.addEventListener('pointerleave', cancelHover);
		node.addEventListener('blur', cancelHover);
		observe();

		const action: ActionReturn<string | undefined> = {
			destroy() {
				cancelHover();
				stopObserving?.();
				node.removeEventListener('pointerenter', onEnter);
				node.removeEventListener('focus', onEnter);
				node.removeEventListener('pointerdown', onDown);
				node.removeEventListener('pointerleave', cancelHover);
				node.removeEventListener('blur', cancelHover);
			},
			update(next) {
				given = next;
				observe();
			}
		};

		return action;
	};
