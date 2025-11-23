import { Component, Input, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CounterComponent } from './counter.component';

@Component({
	selector: 'app-root',
	standalone: true,
	imports: [CommonModule, CounterComponent],
	templateUrl: './app.component.html',
	styleUrls: ['./app.component.css'],
	encapsulation: ViewEncapsulation.None // Allow global styles to apply
})
export class AppComponent {
	@Input() initialCount: number = 0;
}

