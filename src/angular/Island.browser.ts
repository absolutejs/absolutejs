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
	 * so this finds it there and the container adopts it. Matched on
	 * `data-island-id` first, which the server gives every island and
	 * `preserveIslandMarkup` carries into this component's own attributes,
	 * so two islands of the same component with the same props cannot be
	 * mistaken for each other; then on a `persist` key, which is how an
	 * island moved in by a navigation is identified. */
	private findLiveIsland(container: HTMLElement) {
		const islandId = this.attributes['data-island-id'];
		const persist = this.attributes['data-absolute-persist'];
		if (islandId === undefined && persist === undefined) return undefined;
		const selector =
			islandId === undefined
				? `[data-absolute-persist="${CSS.escape(persist ?? '')}"][data-island="true"]`
				: `[data-island-id="${CSS.escape(islandId)}"]`;
		/* The document first: when this runs before the islands bootstrap
		 * has hydrated anything, the island is still the server's markup
		 * sitting in the container Angular is about to discard, and the
		 * registry is empty. Taking it from there keeps ONE element, which
		 * the bootstrap then hydrates once.
		 *
		 * The registry second: by the time a navigation brings a persisted
		 * island in, or the bootstrap has run, the element may be detached
		 * already, and the registry is the only thing still holding it. */
		const inDocument = document.querySelector(selector);
		if (inDocument && !container.contains(inDocument)) return inDocument;

		return registeredIslandElements().find((element) => {
			if (container.contains(element)) return false;

			return element.matches(selector);
		});
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
