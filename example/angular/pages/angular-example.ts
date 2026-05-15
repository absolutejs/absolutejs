import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { usePageContext } from '../../../src/angular/composables/usePageContext';
import { DropdownComponent } from '../components/dropdown.component';
import { AppComponent } from '../components/app.component';

export type Context = {
	initialCount: number;
};

@Component({
	imports: [CommonModule, DropdownComponent, AppComponent],
	selector: 'angular-page',
	standalone: true,
	templateUrl: '../templates/angular-example.html'
})
export class AngularExampleComponent {
	private ctx = usePageContext<Context>();
	initialCount = this.ctx.initialCount;
}
