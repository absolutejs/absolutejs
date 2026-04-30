import '@angular/compiler';
import { defineAngularPage } from '../../../src/angular/page';
import { Component, inject } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';

@Component({
	selector: 'cdk-layout-ssr-test-page',
	standalone: true,
	template: `
		<p id="cdk-layout-matched">{{ matched }}</p>
		<p id="cdk-layout-observer">breakpoint observer ready</p>
	`
})
class CdkLayoutSsrTestPage {
	private readonly breakpointObserver = inject(BreakpointObserver);
	readonly matched = this.breakpointObserver.isMatched('(min-width: 1px)');
}

export const page = defineAngularPage({ component: CdkLayoutSsrTestPage });
