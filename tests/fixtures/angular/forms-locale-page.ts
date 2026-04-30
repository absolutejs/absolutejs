import '@angular/compiler';
import { defineAngularPage } from '../../../src/angular/page';
import { CurrencyPipe, DatePipe, registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { Component, inject, LOCALE_ID, type Provider } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

registerLocaleData(localeFr);

@Component({
	imports: [CurrencyPipe, DatePipe, ReactiveFormsModule],
	selector: 'forms-locale-ssr-test-page',
	standalone: true,
	template: `
		<form [formGroup]="form">
			<input formControlName="name" />
		</form>
		<p id="forms-name">{{ form.controls.name.value }}</p>
		<p id="forms-valid">{{ form.valid }}</p>
		<p id="locale-id">{{ locale }}</p>
		<p id="locale-date">{{ date | date: 'longDate' }}</p>
		<p id="locale-currency">{{ amount | currency: 'EUR' : 'code' }}</p>
	`
})
class FormsLocaleSsrTestPage {
	readonly amount = 1234.5;
	readonly date = new Date(Date.UTC(2024, 0, 1, 12));
	readonly form = new FormGroup({
		name: new FormControl('Ada', { nonNullable: true })
	});
	readonly locale = inject(LOCALE_ID);
}

export const providers: Provider[] = [
	{ provide: LOCALE_ID, useValue: 'fr-FR' }
];

export const page = defineAngularPage({ component: FormsLocaleSsrTestPage });
