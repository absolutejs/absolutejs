import '@angular/compiler';
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
export class CdkLayoutSsrTestPage {
	private readonly breakpointObserver = inject(BreakpointObserver);
	readonly matched = this.breakpointObserver.isMatched('(min-width: 1px)');
}
