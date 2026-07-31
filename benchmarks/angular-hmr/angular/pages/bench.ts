import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { usePageContext } from '../../../../src/angular/composables/usePageContext';
import { CounterComponent } from '../components/counter.component';
import { HeaderComponent } from '../components/header.component';

export type Context = {
	initialCount: number;
};

@Component({
	imports: [CommonModule, HeaderComponent, CounterComponent],
	selector: 'bench-page',
	standalone: true,
	templateUrl: '../templates/bench.html'
})
export class BenchPage {
	private readonly context = usePageContext<Context>();
	initialCount = this.context.initialCount;
}
