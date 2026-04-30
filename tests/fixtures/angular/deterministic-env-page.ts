import '@angular/compiler';
import { defineAngularPage } from '../../../src/angular/page';
import { Component, inject } from '@angular/core';
import {
	DETERMINISTIC_NOW,
	DETERMINISTIC_RANDOM,
	provideDeterministicEnv
} from '../../../src/angular/deterministicEnv';

@Component({
	providers: [
		provideDeterministicEnv({
			now: '2026-04-29T12:00:00.000Z',
			seed: 'dashboard-dots'
		})
	],
	selector: 'deterministic-env-test',
	standalone: true,
	template: `
		<p id="deterministic-now">{{ now }}</p>
		<p id="deterministic-values">{{ values }}</p>
	`
})
export class DeterministicEnvPage {
	private readonly random = inject(DETERMINISTIC_RANDOM);
	readonly now = inject(DETERMINISTIC_NOW);
	readonly values = [
		this.random().toFixed(6),
		this.random().toFixed(6),
		this.random().toFixed(6)
	].join(',');
}

export const page = defineAngularPage({ component: DeterministicEnvPage });
