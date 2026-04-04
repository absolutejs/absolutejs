import '@angular/compiler';
import { Component, HostBinding, Input } from '@angular/core';
import type * as i0 from '@angular/core';
import type { RuntimeIslandRenderProps } from '../../types/island';

@Component({
	selector: 'absolute-island',
	standalone: true,
	template: '<div></div>'
})
export class Island {
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

	@HostBinding('attr.data-abs-props')
	get serializedProps() {
		return JSON.stringify(this.props);
	}
}
