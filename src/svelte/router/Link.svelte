<script lang="ts">
	import { onDestroy, onMount, type Snippet } from 'svelte';
	import type { LinkPrefetchMode } from '../../../types/svelteRouter';
	import {
		belongsToDocumentNavigation,
		navigate,
		preloadRoute
	} from './navigation';
	import {
		canPrefetch,
		observeViewport,
		prefetch,
		resolveDefaultPrefetchMode,
		scheduleHoverPrefetch,
		speculate
	} from './prefetchCache';

	type LinkProps = {
		/** Destination URL — relative or absolute. */
		to: string;
		/** `true` → use `history.replaceState` instead of `pushState`.
		 *  Same name as SvelteKit's `goto` option. */
		replaceState?: boolean;
		/** `'viewport'` (production default) — prefetch when the link
		 *  enters the viewport and on `pointerenter` / `pointerdown`.
		 *  `'hover'` (development default) — prefetch on hover only.
		 *  `'none'` — disable prefetch for this link. */
		prefetch?: LinkPrefetchMode;
		/** Also inject a prerender speculation rule on hover / pointerdown,
		 *  so the target page is fully rendered before the click lands. */
		prerender?: boolean;
		/** Don't reset focus to body on navigate. */
		keepFocus?: boolean;
		/** Leave the scroll position alone on navigate (no scroll to the
		 *  top or to the `#hash` target). */
		noScroll?: boolean;
		/** Forwarded to the underlying `<a>` element. */
		class?: string;
		/** Forwarded to the underlying `<a>` element. */
		target?: string;
		children?: Snippet;
		/** Allow arbitrary HTML attributes through. */
		[key: string]: unknown;
	};

	let {
		to,
		replaceState = false,
		prefetch: prefetchMode,
		prerender = false,
		keepFocus = false,
		noScroll = false,
		class: classProp,
		target,
		children,
		...rest
	}: LinkProps = $props();

	let anchor: HTMLAnchorElement | null = null;
	let hoverHandle: { cancel: () => void } | null = null;
	let unobserveViewport: (() => void) | null = null;

	const resolvedMode = () => prefetchMode ?? resolveDefaultPrefetchMode();

	const isModifierClick = (event: MouseEvent) =>
		event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

	const isExternal = (href: string) => {
		if (typeof window === 'undefined') return false;

		try {
			const url = new URL(href, window.location.href);

			return url.origin !== window.location.origin;
		} catch {
			return false;
		}
	};

	const handleClick = (event: MouseEvent) => {
		if (isModifierClick(event)) return;
		if (event.button !== 0) return;
		if (target && target !== '_self') return;
		if (rest['download'] !== undefined) return;
		if (isExternal(to)) return;
		// No <Router> here has a route for `to` and cross-framework
		// navigation is on: another page owns the URL, so the click goes to
		// the browser, where the navigation layer swaps that page in.
		if (belongsToDocumentNavigation(to)) return;

		event.preventDefault();
		navigate(
			to,
			{
				keepFocus,
				noScroll,
				replaceState
			},
			'link'
		).catch((navigationError: unknown) => {
			console.error(
				'[absolute] <Link> navigation failed:',
				navigationError
			);
		});
	};

	// A lazy route's component chunk is part of what a prefetch warms, on
	// the same triggers (hover, viewport, pointerdown) and under the same
	// data-saver / opt-out rules as the document prefetch.
	const preloadLazyRoute = () => {
		if (canPrefetch()) preloadRoute(to);
	};

	const handlePointerEnter = () => {
		if (resolvedMode() === 'none' || isExternal(to)) return;
		hoverHandle?.cancel();
		hoverHandle = scheduleHoverPrefetch(to, {
			onPrefetch: preloadLazyRoute,
			prerender
		});
	};

	const handlePointerLeave = () => {
		hoverHandle?.cancel();
		hoverHandle = null;
	};

	const handlePointerDown = () => {
		if (resolvedMode() === 'none' || isExternal(to)) return;
		hoverHandle?.cancel();
		hoverHandle = null;
		prefetch(to, { kind: 'route' });
		preloadLazyRoute();
		if (prerender) speculate(to);
	};

	onMount(() => {
		if (resolvedMode() !== 'viewport' || !anchor) return;
		if (isExternal(to)) return;

		unobserveViewport = observeViewport(anchor, to, {
			onVisible: preloadLazyRoute
		});
	});

	onDestroy(() => {
		hoverHandle?.cancel();
		unobserveViewport?.();
	});
</script>

<a
	bind:this={anchor}
	href={to}
	class={classProp}
	{target}
	onclick={handleClick}
	onpointerenter={handlePointerEnter}
	onpointerleave={handlePointerLeave}
	onpointerdown={handlePointerDown}
	onfocus={handlePointerEnter}
	onblur={handlePointerLeave}
	{...rest}
>
	{@render children?.()}
</a>
