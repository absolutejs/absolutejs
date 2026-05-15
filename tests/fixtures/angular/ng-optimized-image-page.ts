import '@angular/compiler';
import { NgOptimizedImage } from '@angular/common';
import { Component } from '@angular/core';

@Component({
	imports: [NgOptimizedImage],
	selector: 'ng-optimized-image-ssr-test-page',
	standalone: true,
	template: `
		<img
			alt="AbsoluteJS test asset"
			height="64"
			ngSrc="/assets/angular-optimized.png"
			priority
			width="64"
		/>
		<p id="optimized-image-ready">optimized image ready</p>
	`
})
export class NgOptimizedImageSsrTestPage {}
