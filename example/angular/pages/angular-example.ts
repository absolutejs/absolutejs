import { Component, Input } from '@angular/core';
// import { CounterButton } from '../components/counter-button';

@Component({
	// imports: [CounterButton],
	selector: 'app-root',
	standalone: true,
	templateUrl: './angular-example.html'
})
export class AngularExample {
	@Input({ required: true })
	declare initialCount: number;
}
