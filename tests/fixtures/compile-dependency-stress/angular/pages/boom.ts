import '@angular/compiler';
import { Component } from '@angular/core';

@Component({
	selector: 'compile-dependency-boom',
	standalone: true,
	template: '<main>DEPENDENCY_SHOULD_NOT_RENDER</main>'
})
export class BoomPage {
	constructor() {
		throw new Error('DEPENDENCY_BOOM_FAILURE');
	}
}

export const page = { component: BoomPage };
