import {
	type AnchorHTMLAttributes,
	type FocusEvent,
	type MouseEvent,
	type PointerEvent,
	type ReactNode,
	useContext
} from 'react';
import type { PrefetchMode } from '../../../types/prefetch';
import { isPrefetchableHref } from '../../client/prefetch';
import { usePrefetch } from '../hooks/usePrefetch';
import { RouterNavigationContext } from './navigationContext';

export type LinkProps = Omit<
	AnchorHTMLAttributes<HTMLAnchorElement>,
	'href' | 'children'
> & {
	/** Destination URL — relative or absolute. */
	href: string;
	/** `'viewport'` (production default) — prefetch when the link enters
	 *  the viewport and on hover / pointerdown.
	 *  `'hover'` (development default) — prefetch on hover only.
	 *  `'none'` — disable prefetch for this link. */
	prefetch?: PrefetchMode;
	/** Also inject a prerender speculation rule on hover / pointerdown so
	 *  the target page is fully rendered before the click lands. */
	prerender?: boolean;
	/** Inside a `<UniversalRouter>`: use `history.replaceState` instead
	 *  of `pushState` for the client-side navigation. */
	replace?: boolean;
	children?: ReactNode;
};

const isModifierClick = (event: MouseEvent<HTMLAnchorElement>) =>
	event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

/**
 * Prefetching anchor — the React counterpart of Next.js `<Link>`.
 *
 * Renders a plain `<a>`; for a same-origin `href` it prefetches the target
 * document when the link scrolls into view (production) and on hover /
 * focus / pointerdown (production + development), so the click resolves
 * from cache. Modifier / middle clicks, `target`, `download` and external
 * URLs pass straight through to the browser.
 *
 * Inside a `<UniversalRouter>` an `href` matching one of the shell's
 * `<Route>`s navigates client-side through react-router; anything else is
 * a real navigation to that page.
 *
 *   import { Link } from '@absolutejs/absolute/react/router';
 *   <Link href="/pricing" prefetch="viewport">Pricing</Link>
 */
export const Link = ({
	href,
	prefetch: prefetchMode,
	prerender = false,
	replace = false,
	target,
	download,
	children,
	onBlur,
	onClick,
	onFocus,
	onPointerDown,
	onPointerEnter,
	onPointerLeave,
	...rest
}: LinkProps) => {
	const navigation = useContext(RouterNavigationContext);
	const {
		ref,
		onBlur: prefetchBlur,
		onFocus: prefetchFocus,
		onPointerDown: prefetchPointerDown,
		onPointerEnter: prefetchPointerEnter,
		onPointerLeave: prefetchPointerLeave
	} = usePrefetch<HTMLAnchorElement>(href, { mode: prefetchMode, prerender });

	const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
		onClick?.(event);
		if (event.defaultPrevented) return;
		if (isModifierClick(event) || event.button !== 0) return;
		if (target && target !== '_self') return;
		if (download !== undefined) return;
		if (!navigation || !isPrefetchableHref(href)) return;
		if (navigation.matches(href) === false) return;

		event.preventDefault();
		navigation.navigate(href, { replace });
	};

	const handlePointerEnter = (event: PointerEvent<HTMLAnchorElement>) => {
		onPointerEnter?.(event);
		prefetchPointerEnter();
	};

	const handlePointerLeave = (event: PointerEvent<HTMLAnchorElement>) => {
		onPointerLeave?.(event);
		prefetchPointerLeave();
	};

	const handlePointerDown = (event: PointerEvent<HTMLAnchorElement>) => {
		onPointerDown?.(event);
		prefetchPointerDown();
	};

	const handleFocus = (event: FocusEvent<HTMLAnchorElement>) => {
		onFocus?.(event);
		prefetchFocus();
	};

	const handleBlur = (event: FocusEvent<HTMLAnchorElement>) => {
		onBlur?.(event);
		prefetchBlur();
	};

	return (
		<a
			{...rest}
			download={download}
			href={href}
			onBlur={handleBlur}
			onClick={handleClick}
			onFocus={handleFocus}
			onPointerDown={handlePointerDown}
			onPointerEnter={handlePointerEnter}
			onPointerLeave={handlePointerLeave}
			ref={ref}
			target={target}
		>
			{children}
		</a>
	);
};
