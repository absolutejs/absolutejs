var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Component, inject, InjectionToken } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DropdownComponent } from '../components/dropdown.component.js';
import { AppComponent } from '../components/app.component.js';
// Injection tokens for component props
export const INITIAL_COUNT = new InjectionToken('INITIAL_COUNT');
let AngularExampleComponent = class AngularExampleComponent {
    initialCount = 0;
    constructor() {
        const initialCountToken = inject(INITIAL_COUNT, { optional: true });
        this.initialCount = initialCountToken ?? 0;
    }
};
AngularExampleComponent = __decorate([
    Component({
        selector: 'angular-page',
        standalone: true,
        imports: [CommonModule, DropdownComponent, AppComponent],
        template: `
		<header>
			<a href="/">AbsoluteJS</a>
			<app-dropdown></app-dropdown>
		</header>
		<app-root [initialCount]="initialCount"></app-root>
	`
    }),
    __metadata("design:paramtypes", [])
], AngularExampleComponent);
export { AngularExampleComponent };
export const factory = (props) => {
    const component = new AngularExampleComponent();
    component.initialCount = props.initialCount;
    return component;
};

export default AngularExampleComponent;

// Angular HMR Runtime Layer (Level 3) — Auto-registration
if (typeof window !== 'undefined' && window.__ANGULAR_HMR__) {
  if (typeof AngularExampleComponent === 'function') window.__ANGULAR_HMR__.register('/Users/graves-homebase/Local Documents/absolute-js/absolutejs/example/angular/pages/angular-example.ts#AngularExampleComponent', AngularExampleComponent);
}
