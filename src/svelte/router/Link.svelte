<script lang="ts">
	import { onDestroy, onMount, type Snippet } from 'svelte';
	import type { LinkPrefetchMode } from '../../../types/svelteRouter';
	import { goto } from './goto';
	import {
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
		/** Don't scroll to top on navigate. */
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

		event.preventDefault();
		void goto(to, {
			keepFocus,
			noScroll,
			replaceState
		});
	};

	const handlePointerEnter = () => {
		if (resolvedMode() === 'none' || isExternal(to)) return;
		hoverHandle?.cancel();
		hoverHandle = scheduleHoverPrefetch(to, { prerender });
	};

	const handlePointerLeave = () => {
		hoverHandle?.cancel();
		hoverHandle = null;
	};

	const handlePointerDown = () => {
		if (resolvedMode() === 'none' || isExternal(to)) return;
		hoverHandle?.cancel();
		hoverHandle = null;
		prefetch(to);
		if (prerender) speculate(to);
	};

	onMount(() => {
		if (resolvedMode() !== 'viewport' || !anchor) return;
		if (isExternal(to)) return;

		unobserveViewport = observeViewport(anchor, to);
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
