import { Component, Input, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CounterComponent } from './counter.component';

@Component({
	encapsulation: ViewEncapsulation.None, // Allow global styles to apply
	imports: [CommonModule, CounterComponent],
	selector: 'app-root',
	standalone: true,
	styleUrls: ['./app.component.css'],
	templateUrl: './app.component.html'
})
export class AppComponent {
	@Input() initialCount: number = 0;
}
