import {
	ChangeDetectionStrategy,
	Component,
	ViewEncapsulation
} from '@angular/core';

@Component({
	changeDetection: ChangeDetectionStrategy.OnPush,
	encapsulation: ViewEncapsulation.None,
	selector: 'app-header',
	standalone: true,
	template: `
		<header style="padding: 1rem; background: #f5f5f5;">
			<h2>{{ title }}</h2>
			<p>{{ subtitle }}</p>
		</header>
	`
})
export class HeaderComponent {
	title = 'AbsoluteJS HMR Benchmark';
	subtitle = 'Run zero';
}
