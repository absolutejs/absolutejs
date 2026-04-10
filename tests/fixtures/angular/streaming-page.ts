import { Component } from '@angular/core';
import { StreamSlotComponent } from '../../../src/angular/components/stream-slot.component';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Component({
	imports: [StreamSlotComponent],
	selector: 'abs-streaming-test-page',
	standalone: true,
	template: `
		<main>
			<abs-stream-slot
				fallbackHtml="<p>fast loading</p>"
				id="angular-fast"
				[resolve]="fastResolve"
			></abs-stream-slot>
			<abs-stream-slot
				fallbackHtml="<p>slow loading</p>"
				id="angular-slow"
				[resolve]="slowResolve"
			></abs-stream-slot>
		</main>
	`
})
export class AngularStreamingTestPage {
	readonly fastResolve = async () => {
		await delay(5);

		return '<section>angular fast resolved</section>';
	};

	readonly slowResolve = async () => {
		await delay(20);

		return '<section>angular slow resolved</section>';
	};
}

export default AngularStreamingTestPage;
