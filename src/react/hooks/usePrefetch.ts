import { useCallback, useEffect, useRef } from 'react';
import type {
	HoverPrefetchHandle,
	PrefetchKind,
	PrefetchMode
} from '../../../types/prefetch';
import {
	isPrefetchableHref,
	observeViewport,
	prefetch,
	resolveDefaultPrefetchMode,
	scheduleHoverPrefetch,
	speculate
} from '../../client/prefetch';

export type UsePrefetchOptions = {
	/** `'viewport'` (production default), `'hover'` (development default)
	 *  or `'none'`. */
	mode?: PrefetchMode;
	/** What to warm. Defaults to `'document'` for the viewport trigger and
	 *  `'route'` (document + route data + the modules / CSS it names) for
	 *  hover and pointerdown. */
	kind?: PrefetchKind;
	/** Also inject a prerender speculation rule when the hover /
	 *  pointerdown trigger fires. */
	prerender?: boolean;
};

/**
 * Prefetch `href` when the returned handlers fire. Spread the handlers on
 * any element and attach `ref` to it for viewport-triggered prefetching:
 *
 *   const { ref, ...prefetchHandlers } = usePrefetch('/pricing');
 *   <a href="/pricing" ref={ref} {...prefetchHandlers}>Pricing</a>
 *
 * Cross-origin, hash-only and empty hrefs are ignored, as is everything
 * when the user has data-saver on or the page set
 * `window.__ABSOLUTE_PREFETCH__ = false`.
 */
export const usePrefetch = <TElement extends HTMLElement = HTMLElement>(
	href: string | undefined,
	options: UsePrefetchOptions = {}
) => {
	const { kind, mode, prerender = false } = options;
	const viewportKind = kind ?? 'document';
	const triggerKind = kind ?? 'route';
	const elementRef = useRef<TElement | null>(null);
	const hoverHandle = useRef<HoverPrefetchHandle | null>(null);

	const cancelHover = useCallback(() => {
		hoverHandle.current?.cancel();
		hoverHandle.current = null;
	}, []);

	const isActive = useCallback(() => {
		if (href === undefined || !isPrefetchableHref(href)) return false;
		const resolved = mode ?? resolveDefaultPrefetchMode();

		return resolved !== 'none';
	}, [href, mode]);

	useEffect(() => {
		const element = elementRef.current;
		if (!element || href === undefined || !isActive()) return undefined;
		const resolved = mode ?? resolveDefaultPrefetchMode();
		if (resolved !== 'viewport') return undefined;

		return observeViewport(element, href, { kind: viewportKind });
	}, [href, isActive, mode, viewportKind]);

	useEffect(() => cancelHover, [cancelHover]);

	const onPointerEnter = useCallback(() => {
		if (href === undefined || !isActive()) return;
		cancelHover();
		hoverHandle.current = scheduleHoverPrefetch(href, {
			kind: triggerKind,
			prerender
		});
	}, [cancelHover, href, isActive, prerender, triggerKind]);

	const onPointerDown = useCallback(() => {
		if (href === undefined || !isActive()) return;
		cancelHover();
		prefetch(href, { kind: triggerKind });
		if (prerender) speculate(href);
	}, [cancelHover, href, isActive, prerender, triggerKind]);

	return {
		onBlur: cancelHover,
		onFocus: onPointerEnter,
		onPointerDown,
		onPointerEnter,
		onPointerLeave: cancelHover,
		ref: elementRef
	};
};
