import { Component } from '@angular/core';

@Component({
	selector: 'abs-defer-streaming-test-page',
	standalone: true,
	template: `
		<main>
			@defer (on timer(5ms)) {
				<section>angular defer fast resolved</section>
			} @placeholder {
				<p>fast loading</p>
			}

			@defer (on timer(20ms)) {
				<section>angular defer slow resolved</section>
			} @placeholder {
				<p>slow loading</p>
			}
		</main>
	`
})
export class AngularDeferStreamingTestPage {}
