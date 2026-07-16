var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Component, Input, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CounterComponent } from './counter.component.js';
let AppComponent = class AppComponent {
    initialCount = 0;
};
__decorate([
    Input(),
    __metadata("design:type", Number)
], AppComponent.prototype, "initialCount", void 0);
AppComponent = __decorate([
    Component({
        selector: 'app-root',
        standalone: true,
        imports: [CommonModule, CounterComponent],
        template: `<main>
	<nav>
		<a href="https://absolutejs.com" target="_blank">
			<img class="logo" src="/assets/png/absolutejs-temp.png" alt="AbsoluteJS Logo" />
		</a>
		<a href="https://angular.dev/">
			<img class="logo angular" src="/assets/svg/angular.svg" alt="Angular Logo" />
		</a>
	</nav>
	<h1>AbsoluteJS + Angular</h1>
	<app-counter [initialCount]="initialCount"></app-counter>
	<p>
		Edit <code>example/angular/pages/angular-example.ts</code> and save to
		test HMR.
	</p>
	<p style="margin-top: 2rem">
		Explore the other pages to see how AbsoluteJS seamlessly unifies
		multiple frameworks on a single server.
	</p>
	<p style="color: #777; font-size: 1rem; margin-top: 2rem">
		Click on the AbsoluteJS and Angular logos to learn more.
	</p>
</main>`,
        styles: [`code {
	background-color: #1a1a1a;
	padding: 0.2rem 0.4rem;
	border-radius: 0.25rem;
	font-size: 0.9em;
}

@media (prefers-color-scheme: light) {
	code {
		background-color: #f0f0f0;
	}
}
`],
        encapsulation: ViewEncapsulation.None // Allow global styles to apply
    })
], AppComponent);
export { AppComponent };
