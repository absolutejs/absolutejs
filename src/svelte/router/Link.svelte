<script lang="ts">
	import { onDestroy, onMount, type Snippet } from 'svelte';
	import type { LinkPrefetchMode } from '../../../types/svelteRouter';
	import { goto } from './goto';
	import { prefetch, scheduleHoverPrefetch } from './prefetchCache';

	type LinkProps = {
		/** Destination URL — relative or absolute. */
		to: string;
		/** `true` → use `history.replaceState` instead of `pushState`.
		 *  Same name as SvelteKit's `goto` option. */
		replaceState?: boolean;
		/** `'hover'` (default) — prefetch on `pointerenter`.
		 *  `'viewport'` — prefetch when the link enters the viewport.
		 *  `'none'` — disable prefetch for this link. */
		prefetch?: LinkPrefetchMode;
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
		prefetch: prefetchMode = 'hover',
		keepFocus = false,
		noScroll = false,
		class: classProp,
		target,
		children,
		...rest
	}: LinkProps = $props();

	let anchor: HTMLAnchorElement | null = null;
	let hoverHandle: { cancel: () => void } | null = null;
	let viewportObserver: IntersectionObserver | null = null;

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
		if (prefetchMode !== 'hover' || isExternal(to)) return;
		hoverHandle?.cancel();
		hoverHandle = scheduleHoverPrefetch(to);
	};

	const handlePointerLeave = () => {
		hoverHandle?.cancel();
		hoverHandle = null;
	};

	onMount(() => {
		if (prefetchMode !== 'viewport' || !anchor) return;
		if (typeof IntersectionObserver === 'undefined') return;
		if (isExternal(to)) return;

		viewportObserver = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						prefetch(to);
						viewportObserver?.disconnect();
						return;
					}
				}
			},
			{ rootMargin: '128px' }
		);
		viewportObserver.observe(anchor);
	});

	onDestroy(() => {
		hoverHandle?.cancel();
		viewportObserver?.disconnect();
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
	{...rest}
>
	{@render children?.()}
</a>
