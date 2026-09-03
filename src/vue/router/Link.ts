import { defineComponent, getCurrentInstance, h } from 'vue';
import type { PrefetchMode } from '../../../types/prefetch';
import { isPrefetchableHref } from '../../client/prefetch';
import { usePrefetch } from '../usePrefetch';

type LinkProps = {
	href: string;
	prefetch?: PrefetchMode;
	prerender?: boolean;
	replace?: boolean;
	target?: string;
	download?: string | boolean;
};

/** Duck-typed view of the vue-router instance a page's auto-router
 *  installs on the app. Read through `appContext.config.globalProperties`
 *  instead of `useRouter()` so this module never imports `vue-router` —
 *  it is inlined into each page bundle, and a second copy here would not
 *  share the page's provide/inject symbols. */
type RouterLike = {
	push: (to: string) => unknown;
	replace: (to: string) => unknown;
	resolve: (to: string) => { matched: ArrayLike<unknown> };
};

const isRouterLike = (value: unknown): value is RouterLike =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'push') === 'function' &&
	typeof Reflect.get(value, 'replace') === 'function' &&
	typeof Reflect.get(value, 'resolve') === 'function';

/** Find the router the page's `setupApp` installed via `app.use(router)`
 *  — vue-router registers itself as `app.config.globalProperties.$router`.
 *  `null` when the page has no SPA shell. */
const discoverRouter = () => {
	const instance = getCurrentInstance();
	if (!instance) return null;
	const candidate = Reflect.get(
		instance.appContext.config.globalProperties,
		'$router'
	);

	return isRouterLike(candidate) ? candidate : null;
};

const isModifierClick = (event: MouseEvent) =>
	event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

const routerMatches = (router: RouterLike, href: string) => {
	try {
		return router.resolve(href).matched.length > 0;
	} catch {
		return false;
	}
};

/**
 * Prefetching anchor — the Vue counterpart of Next.js `<Link>`.
 *
 * Renders a plain `<a>`; for a same-origin `href` it prefetches the target
 * document when the link scrolls into view (production) and on hover /
 * focus / pointerdown (production + development), so the click resolves
 * from cache. Modifier / middle clicks, `target`, `download` and external
 * URLs pass straight through to the browser.
 *
 * Inside an SPA shell (a page exporting `routes`), an `href` matching one
 * of the shell's routes navigates client-side through the page's own
 * vue-router; anything else is a real navigation to that page.
 *
 *   import { Link } from '@absolutejs/absolute/vue';
 *   <Link href="/pricing" prefetch="viewport">Pricing</Link>
 */
export const Link = defineComponent({
	name: 'AbsoluteLink',
	props: {
		download: { default: undefined, type: [String, Boolean] },
		href: { required: true, type: String },
		prefetch: { default: undefined, type: String },
		prerender: { default: false, type: Boolean },
		replace: { default: false, type: Boolean },
		target: { default: undefined, type: String }
	},
	setup(props: LinkProps, { slots }) {
		const router = discoverRouter();
		const {
			element,
			onBlur,
			onFocus,
			onPointerdown,
			onPointerenter,
			onPointerleave
		} = usePrefetch(() => props.href, {
			mode: () => props.prefetch,
			prerender: () => props.prerender
		});

		const onClick = (event: MouseEvent) => {
			if (event.defaultPrevented) return;
			if (isModifierClick(event) || event.button !== 0) return;
			if (props.target && props.target !== '_self') return;
			if (props.download !== undefined) return;
			if (!router || !isPrefetchableHref(props.href)) return;
			if (!routerMatches(router, props.href)) return;

			event.preventDefault();
			if (props.replace) {
				void router.replace(props.href);
			} else {
				void router.push(props.href);
			}
		};

		return () =>
			h(
				'a',
				{
					download: props.download,
					href: props.href,
					onBlur,
					onClick,
					onFocus,
					onPointerdown,
					onPointerenter,
					onPointerleave,
					ref: element,
					target: props.target
				},
				slots.default?.()
			);
	}
});
