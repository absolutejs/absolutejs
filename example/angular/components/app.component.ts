import { Component, Input, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CounterComponent } from './counter.component';

@Component({
	encapsulation: ViewEncapsulation.None,
	imports: [CommonModule, CounterComponent],
	selector: 'app-root',
	standalone: true,
	styleUrl: '../../styles/app.component.css',
	templateUrl: '../templates/app.component.html'
})
export class AppComponent {
	@Input() initialCount: number = 0;
}
