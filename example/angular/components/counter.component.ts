import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
	imports: [CommonModule],
	selector: 'app-counter',
	standalone: true,
	styleUrl: '../../styles/counter.component.css',
	templateUrl: '../templates/counter.component.html'
})
export class CounterComponent {
	@Input() initialCount: number = 0;
	count: number = 0;

	ngOnInit() {
		this.count = this.initialCount;
	}

	increment() {
		this.count++;
	}
}
