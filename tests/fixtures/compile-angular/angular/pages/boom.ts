import '@angular/compiler';
import { Component } from '@angular/core';

@Component({
	selector: 'compile-angular-boom',
	standalone: true,
	template: '<main>ANGULAR_SHOULD_NOT_RENDER</main>'
})
export class BoomPage {
	constructor() {
		throw new Error('ANGULAR_BOOM_FAILURE');
	}
}

export const page = { component: BoomPage };
