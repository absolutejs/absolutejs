import {
	getCurrentScope,
	type MaybeRefOrGetter,
	onScopeDispose,
	type Ref,
	ref,
	toValue,
	watchEffect
} from 'vue';
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
	/** `'viewport'` (production default), `'hover'` (development default)
	 *  or `'none'`. */
	mode?: MaybeRefOrGetter<PrefetchMode | undefined>;
	/** Defaults to `'document'`. */
	kind?: PrefetchKind;
	/** Also inject a prerender speculation rule when the hover /
	 *  pointerdown trigger fires. */
	prerender?: MaybeRefOrGetter<boolean | undefined>;
};

/**
 * Prefetch `href` when the returned handlers fire. Bind `element` as the
 * template ref of any element for viewport-triggered prefetching:
 *
 *   const { element, onPointerenter, onPointerleave } = usePrefetch('/pricing');
 *   <a href="/pricing" :ref="element" @pointerenter="onPointerenter" …>
 *
 * Cross-origin, hash-only and empty hrefs are ignored, as is everything
 * when the user has data-saver on or the page set
 * `window.__ABSOLUTE_PREFETCH__ = false`.
 */
export const usePrefetch = (
	href: MaybeRefOrGetter<string | undefined>,
	options: UsePrefetchOptions = {}
) => {
	const kind = options.kind ?? 'document';
	const element: Ref<HTMLElement | null> = ref(null);
	let hoverHandle: HoverPrefetchHandle | null = null;

	const currentHref = () => toValue(href);
	const currentMode = () => toValue(options.mode) ?? resolveDefaultPrefetchMode();
	const shouldPrerender = () => toValue(options.prerender) === true;

	const isActive = () => {
		const target = currentHref();
		if (target === undefined || !isPrefetchableHref(target)) return false;

		return currentMode() !== 'none';
	};

	const cancelHover = () => {
		hoverHandle?.cancel();
		hoverHandle = null;
	};

	const onPointerenter = () => {
		const target = currentHref();
		if (target === undefined || !isActive()) return;
		cancelHover();
		hoverHandle = scheduleHoverPrefetch(target, {
			kind,
			prerender: shouldPrerender()
		});
	};

	const onPointerdown = () => {
		const target = currentHref();
		if (target === undefined || !isActive()) return;
		cancelHover();
		prefetch(target, { kind });
		if (shouldPrerender()) speculate(target);
	};

	if (typeof window !== 'undefined') {
		watchEffect((onCleanup) => {
			const node = element.value;
			const target = currentHref();
			if (!node || target === undefined || !isActive()) return;
			if (currentMode() !== 'viewport') return;
			onCleanup(observeViewport(node, target, { kind }));
		}, { flush: 'post' });
	}

	if (getCurrentScope()) onScopeDispose(cancelHover);

	return {
		element,
		onBlur: cancelHover,
		onFocus: onPointerenter,
		onPointerdown,
		onPointerenter,
		onPointerleave: cancelHover
	};
};
