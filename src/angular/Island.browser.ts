import '@angular/compiler';
import {
	type AfterViewInit,
	Component,
	ElementRef,
	Input,
	type OnChanges,
	ViewChild
} from '@angular/core';
import type * as i0 from '@angular/core';
import type { RuntimeIslandRenderProps } from '../../types/island';
import { registeredIslandElements } from '../client/islandDisposers';
import { preserveIslandMarkup } from '../client/preserveIslandMarkup';
import { serializeIslandAttributes } from '../core/islandMarkupAttributes';

/* The marker attributes that identify which island an element is, and the
 * value the islands runtime reads when one is absent. Two elements that
 * agree on all four are the same island rendered twice — the server's copy
 * and the one this component would otherwise create. */
const ISLAND_SIGNATURE: Readonly<Record<string, string>> = {
	'data-component': '',
	'data-framework': '',
	'data-hydrate': 'load',
	'data-props': '{}'
};

/* Claimed once, by one component instance. Two islands of the same
 * component with the same props have the same signature, so without this
 * the second instance would adopt — and so steal — the element the first
 * already took; each takes the first element nobody has taken yet, in
 * document order, which is the order the instances set up in. This is the
 * claim `claimServerIslandStyleLink` already makes for the same reason.
 *
 * Weak, and never cleared: entries are elements, so a visit's claims fall
 * away with the markup they were made against, and a later visit's
 * elements are new ones. A soft navigation does re-run this page's entry
 * module, but its imports keep their URLs, so this module is not
 * re-evaluated and the set cannot be relied on to reset. */
const claimedIslands = new WeakSet<Element>();

const hasSignature = (element: Element, attributes: Record<string, string>) =>
	Object.entries(ISLAND_SIGNATURE).every(
		([name, fallback]) =>
			(element.getAttribute(name) ?? fallback) ===
			(attributes[name] ?? fallback)
	);

@Component({
	selector: 'absolute-island',
	standalone: true,
	template: '<div #container [attr.ngSkipHydration]="true"></div>'
})
export class Island implements AfterViewInit, OnChanges {
	@Input() component = '';
	@Input() framework: RuntimeIslandRenderProps['framework'] = 'react';
	@Input() hydrate: RuntimeIslandRenderProps['hydrate'] = 'load';
	@Input() persist: RuntimeIslandRenderProps['persist'] = undefined;
	@Input() props: RuntimeIslandRenderProps['props'] = {};

	declare static ɵfac: i0.ɵɵFactoryDeclaration<Island, never>;
	declare static ɵcmp: i0.ɵɵComponentDeclaration<
		Island,
		'absolute-island',
		never,
		{
			component: { alias: 'component'; required: false };
			framework: { alias: 'framework'; required: false };
			hydrate: { alias: 'hydrate'; required: false };
			persist: { alias: 'persist'; required: false };
			props: { alias: 'props'; required: false };
		},
		Record<string, string>,
		never,
		never,
		true,
		never
	>;

	@ViewChild('container', { static: true })
	private readonly container?: ElementRef<HTMLElement>;

	private markup = '';

	private attributes: Record<string, string> = {};

	ngOnChanges() {
		const runtimeProps = {
			component: this.component,
			framework: this.framework,
			hydrate: this.hydrate,
			persist: this.persist,
			props: this.props
		} satisfies RuntimeIslandRenderProps;
		const { attributes, innerHTML } = preserveIslandMarkup(runtimeProps);

		this.attributes = attributes;
		this.markup = `<div ${serializeIslandAttributes(attributes)}>${innerHTML}</div>`;
		this.applyMarkup();
	}

	ngAfterViewInit() {
		this.applyMarkup();
	}

	/* The island this component is about to re-create, if it already exists
	 * as a live instance.
	 *
	 * Angular client-renders this container — `ngSkipHydration`, because
	 * the server replaces the whole `<absolute-island>` element with the
	 * island's markup and there is no host element left for Angular to
	 * hydrate. So the container Angular ends up with is a fresh element,
	 * and the server's container, holding the island the islands bootstrap
	 * already hydrated, is on its way out. Writing markup into the new
	 * container hydrates a SECOND instance and leaves the first running on
	 * detached nodes: two disposers for one element, on every load.
	 *
	 * The disposer registry is the only thing still holding that instance,
	 * so this finds it there and the container adopts it.
	 *
	 * Matched on `data-island-id` first, then a `persist` key — which is
	 * how an island moved in by a navigation is identified — and failing
	 * both, on the island's signature.
	 *
	 * The signature case is the ordinary one, not the exception: the
	 * server emits `data-island-id` only for an island that is itself an
	 * Angular component, because that is the one case where Angular needs
	 * a selector to bootstrap into. A Svelte, React or Vue island on an
	 * Angular page has no id and no persist key, so until this fell back
	 * to the signature, an ordinary island could never be adopted. The
	 * component wrote a second copy of it on every render of the page,
	 * which on a soft navigation back meant the island the navigation
	 * layer had just inserted — already hydrated and running — was left
	 * orphaned on detached nodes while a fresh one took its place. */
	private islandMatcher() {
		const islandId = this.attributes['data-island-id'];
		const persist = this.attributes['data-absolute-persist'];
		if (islandId !== undefined)
			return (element: Element) =>
				element.getAttribute('data-island-id') === islandId;
		if (persist !== undefined)
			return (element: Element) =>
				element.getAttribute('data-absolute-persist') === persist;

		return (element: Element) =>
			!claimedIslands.has(element) &&
			hasSignature(element, this.attributes);
	}

	private findLiveIsland(container: HTMLElement) {
		const matches = this.islandMatcher();
		/* The document first: when this runs before the islands bootstrap
		 * has hydrated anything, the island is still the server's markup
		 * sitting in the container Angular is about to discard, and the
		 * registry is empty. Taking it from there keeps ONE element, which
		 * the bootstrap then hydrates once.
		 *
		 * The registry second: by the time a navigation brings a persisted
		 * island in, or the bootstrap has run, the element may be detached
		 * already, and the registry is the only thing still holding it. */
		const live = [
			...document.querySelectorAll<HTMLElement>('[data-island="true"]'),
			...registeredIslandElements()
		].find((element) => !container.contains(element) && matches(element));
		if (live) claimedIslands.add(live);

		return live;
	}

	/* Write once.
	 *
	 * This runs from both `ngOnChanges` and `ngAfterViewInit`, and the
	 * `innerHTML === markup` guard below does not stop the second call: by
	 * then the islands runtime has hydrated the island this component
	 * wrote, which adds `data-hydrated` and the component's own rendered
	 * markup, so the container's HTML no longer matches the pristine
	 * string. The second write therefore replaced a live island with a
	 * fresh copy — the first instance orphaned on detached nodes, two
	 * disposers for one element, on every load of every Angular page with
	 * an island. It read as a hydration problem and was not one: the
	 * component was overwriting itself.
	 *
	 * An island already in the container is the signal to leave it alone,
	 * whoever put it there — this component's earlier call, or the
	 * navigation layer moving a persisted island in. */
	private applyMarkup() {
		const container = this.container?.nativeElement;
		if (!container) return;
		if (container.querySelector('[data-island="true"]') !== null) return;
		if (container.innerHTML === this.markup) return;
		const live = this.findLiveIsland(container);
		if (live) {
			container.replaceChildren(live);

			return;
		}
		container.innerHTML = this.markup;
	}
}
