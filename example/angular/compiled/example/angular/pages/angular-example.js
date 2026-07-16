import { Component, inject, InjectionToken } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DropdownComponent } from '../components/dropdown.component.js';
import { AppComponent } from '../components/app.component.js';
import * as i0 from "@angular/core";
// Injection tokens for component props
export const INITIAL_COUNT = new InjectionToken('INITIAL_COUNT');
export class AngularExampleComponent {
    constructor() {
        this.initialCount = 0;
        const initialCountToken = inject(INITIAL_COUNT, { optional: true });
        this.initialCount = initialCountToken ?? 0;
    }
    static { this.ɵfac = function AngularExampleComponent_Factory(__ngFactoryType__) { return new (__ngFactoryType__ || AngularExampleComponent)(); }; }
    static { this.ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({ type: AngularExampleComponent, selectors: [["angular-page"]], decls: 5, vars: 1, consts: [["href", "/"], [3, "initialCount"]], template: function AngularExampleComponent_Template(rf, ctx) { if (rf & 1) {
            i0.ɵɵelementStart(0, "header")(1, "a", 0);
            i0.ɵɵtext(2, "AbsoluteJS");
            i0.ɵɵelementEnd();
            i0.ɵɵelement(3, "app-dropdown");
            i0.ɵɵelementEnd();
            i0.ɵɵelement(4, "app-root", 1);
        } if (rf & 2) {
            i0.ɵɵadvance(4);
            i0.ɵɵproperty("initialCount", ctx.initialCount);
        } }, dependencies: [CommonModule, DropdownComponent, AppComponent], encapsulation: 2 }); }
}
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassMetadata(AngularExampleComponent, [{
        type: Component,
        args: [{
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
            }]
    }], () => [], null); })();
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassDebugInfo(AngularExampleComponent, { className: "AngularExampleComponent", filePath: "example/angular/pages/angular-example.ts", lineNumber: 25 }); })();
export const factory = (props) => {
    const component = new AngularExampleComponent();
    component.initialCount = props.initialCount;
    return component;
};

export default AngularExampleComponent;
