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

	ngOnChanges() {
		const runtimeProps = {
			component: this.component,
			framework: this.framework,
			hydrate: this.hydrate,
			props: this.props
		} satisfies RuntimeIslandRenderProps;
		const { attributes, innerHTML } = preserveIslandMarkup(runtimeProps);

		this.markup = `<div ${serializeIslandAttributes(attributes)}>${innerHTML}</div>`;
		this.applyMarkup();
	}

	ngAfterViewInit() {
		this.applyMarkup();
	}

	private applyMarkup() {
		const container = this.container?.nativeElement;
		if (!container) return;
		if (container.innerHTML === this.markup) return;
		container.innerHTML = this.markup;
	}
}
