import '@angular/compiler';
import { defineAngularPage } from '../../../src/angular/page';
import {
	Component,
	inject,
	InjectionToken,
	type Provider
} from '@angular/core';

export const PROVIDER_MODEL_VALUE = new InjectionToken<string>(
	'PROVIDER_MODEL_VALUE'
);

@Component({
	selector: 'provider-model-test',
	standalone: true,
	template: '<p id="provider-model-value">{{ value }}</p>'
})
export class ProviderModelPage {
	readonly value = inject(PROVIDER_MODEL_VALUE);
}

export const providers: Provider[] = [
	{ provide: PROVIDER_MODEL_VALUE, useValue: 'page-module-provider' }
];

export const page = defineAngularPage({ component: ProviderModelPage });
