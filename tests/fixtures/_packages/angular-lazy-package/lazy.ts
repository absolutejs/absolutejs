import { Component } from '@angular/core';

@Component({
	selector: 'external-lazy-component',
	standalone: true,
	template: '<p id="external-lazy-component">external package lazy route</p>'
})
export class ExternalLazyComponent {}
