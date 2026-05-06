import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { defineAngularPage } from '@absolutejs/absolute/angular';
import { CounterComponent } from '../components/counter.component';
import { HeaderComponent } from '../components/header.component';

type BenchProps = {
	initialCount: number;
};

@Component({
	imports: [CommonModule, HeaderComponent, CounterComponent],
	selector: 'bench-page',
	standalone: true,
	templateUrl: '../templates/bench.html'
})
export class BenchPage {
	initialCount: number = 0;
}

export const page = defineAngularPage<BenchProps>({
	component: BenchPage
});
