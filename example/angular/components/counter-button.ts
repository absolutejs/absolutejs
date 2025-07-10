import { Component, signal } from '@angular/core';

@Component({
	selector: 'app-counter-button',
	standalone: true,
	templateUrl: './counter-button.html'
})
export class CounterButton {
	private _count = signal(0);
	count = () => this._count();
	increment() {
		this._count.update((count) => count + 1);
	}
}
