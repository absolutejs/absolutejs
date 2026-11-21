import {
	DestroyRef,
	Directive,
	ElementRef,
	type OnInit,
	inject,
	input
} from '@angular/core';
import {
	requestPrefetch,
	requestSpeculation,
	getPrefetchRuntime
} from '../../utils/prefetchRef';

/* Imports only `../../utils/prefetchRef`, which has no imports of its own
 * and is copied into the Angular partial-compile workspace the way
 * `csrfTokenRef` is (`compileAngularComponentsPartial` in
 * scripts/build.ts). Importing `src/client/prefetch` directly would make
 * that step emit nothing and publish every Angular component empty — see
 * the note in form-action.directive.ts. */

/** `'hover'` arms pointer/focus listeners, `'viewport'` prefetches when
 *  the link scrolls into view, `'none'` disables it. Omitted follows the
 *  framework default, which is `'viewport'` in production and `'hover'`
 *  in development. */
export type AbsoluteLinkPrefetchMode = 'hover' | 'none' | 'viewport';

const HOVER_DEBOUNCE_MS = 250;
const VIEWPORT_ROOT_MARGIN = '128px';

const isAnchor = (value: unknown): value is HTMLAnchorElement =>
	typeof HTMLAnchorElement !== 'undefined' &&
	value instanceof HTMLAnchorElement;

/**
 * Prefetching anchor for Angular — the counterpart of the React, Svelte
 * and Vue `<Link>`, as a directive so it sits on a real `<a>`:
 *
 *   <a absLink href="/pricing">Pricing</a>
 *   <a absLink href="/docs" prefetch="hover">Docs</a>
 *
 * It never calls `preventDefault`. The click goes to whatever should have
 * it: the cross-framework navigation layer when a page has called
 * `enableNavigation()`, and the browser otherwise. That is deliberate —
 * `routerLink` is Angular's way to navigate inside an Angular router, and
 * a directive that intercepted clicks would compete with it. This one
 * warms the cache and stays out of the way.
 *
 * Prefetching needs the client prefetch runtime on the page, which
 * `enableNavigation()` brings in. Without it every call is a no-op and
 * the link still works — prefetching is an optimisation, so a page that
 * ships no client runtime simply does not get one.
 */
@Directive({
	selector: 'a[absLink]',
	standalone: true
})
export class AbsoluteLinkDirective implements OnInit {
	private readonly destroyRef = inject(DestroyRef);
	private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

	/** Overrides the element's own `href`, for a link whose target is
	 *  computed. */
	readonly absLink = input<string>('');
	readonly prefetch = input<AbsoluteLinkPrefetchMode | undefined>(undefined);
	/** Ask the browser to pre-render the target, not just fetch it. */
	readonly prerender = input(false);

	private hoverTimer: ReturnType<typeof setTimeout> | undefined;
	private observer: IntersectionObserver | undefined;
	private warmed = false;

	ngOnInit() {
		if (typeof window === 'undefined') return;
		const mode = this.resolveMode();
		if (mode === 'none') return;
		if (mode === 'viewport') this.observeViewport();
		else this.listenForIntent();
		this.destroyRef.onDestroy(() => this.teardown());
	}

	/** The URL to warm: the explicit input, else the anchor's own href. */
	private target() {
		const explicit = this.absLink();
		if (explicit) return explicit;
		const { nativeElement } = this.elementRef;

		return isAnchor(nativeElement)
			? nativeElement.getAttribute('href')
			: null;
	}

	private resolveMode() {
		const configured = this.prefetch();
		if (configured) return configured;
		const runtime = getPrefetchRuntime();
		// No runtime: the mode does not matter, nothing will happen either
		// way, so take the cheaper path and arm no listeners.
		if (!runtime) return 'none';

		return runtime.resolveDefaultPrefetchMode() === 'hover'
			? 'hover'
			: 'viewport';
	}

	/* Once per link: a second hover should not queue a second fetch.
	 *
	 * `kind` matches what `usePrefetch` gives the other frameworks' links.
	 * A deliberate signal — hover, focus, pointerdown — takes `'route'`,
	 * which is the document plus the payload naming the modules and CSS to
	 * warm alongside it. Scrolling into view is a guess, so it takes
	 * `'document'` and fetches the HTML alone. */
	private warm(kind: 'document' | 'route') {
		if (this.warmed) return;
		const href = this.target();
		if (!href) return;
		this.warmed = requestPrefetch(href, kind);
		if (this.warmed && this.prerender()) requestSpeculation(href);
	}

	private listenForIntent() {
		const element = this.elementRef.nativeElement;
		const start = () => {
			this.hoverTimer ??= setTimeout(
				() => this.warm('route'),
				HOVER_DEBOUNCE_MS
			);
		};
		const cancel = () => {
			if (this.hoverTimer === undefined) return;
			clearTimeout(this.hoverTimer);
			this.hoverTimer = undefined;
		};
		// `pointerdown` and `focus` warm immediately: by then the intent is
		// no longer a guess.
		element.addEventListener('pointerenter', start);
		element.addEventListener('pointerleave', cancel);
		element.addEventListener('focus', () => this.warm('route'));
		element.addEventListener('pointerdown', () => this.warm('route'));
	}

	private observeViewport() {
		if (typeof IntersectionObserver === 'undefined') {
			this.warm('document');

			return;
		}
		this.observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				this.warm('document');
				this.observer?.disconnect();
			},
			{ rootMargin: VIEWPORT_ROOT_MARGIN }
		);
		this.observer.observe(this.elementRef.nativeElement);
	}

	private teardown() {
		if (this.hoverTimer !== undefined) clearTimeout(this.hoverTimer);
		this.hoverTimer = undefined;
		this.observer?.disconnect();
		this.observer = undefined;
	}
}
