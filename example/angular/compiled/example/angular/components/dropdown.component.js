import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as i0 from "@angular/core";
export class DropdownComponent {
    constructor() {
        this.isOpen = false;
    }
    static { this.ɵfac = function DropdownComponent_Factory(__ngFactoryType__) { return new (__ngFactoryType__ || DropdownComponent)(); }; }
    static { this.ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({ type: DropdownComponent, selectors: [["app-dropdown"]], decls: 16, vars: 1, consts: [[1, "dropdown", 3, "mouseenter", "mouseleave"], [1, "menu"], ["href", "/"], ["href", "/react"], ["href", "/svelte"], ["href", "/vue"], ["href", "/angular"], ["href", "/htmx"]], template: function DropdownComponent_Template(rf, ctx) { if (rf & 1) {
            i0.ɵɵelementStart(0, "details", 0);
            i0.ɵɵlistener("mouseenter", function DropdownComponent_Template_details_mouseenter_0_listener() { return ctx.isOpen = true; })("mouseleave", function DropdownComponent_Template_details_mouseleave_0_listener() { return ctx.isOpen = false; });
            i0.ɵɵelementStart(1, "summary");
            i0.ɵɵtext(2, "Pages");
            i0.ɵɵelementEnd();
            i0.ɵɵelementStart(3, "nav", 1)(4, "a", 2);
            i0.ɵɵtext(5, "HTML");
            i0.ɵɵelementEnd();
            i0.ɵɵelementStart(6, "a", 3);
            i0.ɵɵtext(7, "React");
            i0.ɵɵelementEnd();
            i0.ɵɵelementStart(8, "a", 4);
            i0.ɵɵtext(9, "Svelte");
            i0.ɵɵelementEnd();
            i0.ɵɵelementStart(10, "a", 5);
            i0.ɵɵtext(11, "Vue");
            i0.ɵɵelementEnd();
            i0.ɵɵelementStart(12, "a", 6);
            i0.ɵɵtext(13, "Angular");
            i0.ɵɵelementEnd();
            i0.ɵɵelementStart(14, "a", 7);
            i0.ɵɵtext(15, "HTMX");
            i0.ɵɵelementEnd()()();
        } if (rf & 2) {
            i0.ɵɵattribute("open", ctx.isOpen ? "" : null);
        } }, dependencies: [CommonModule], encapsulation: 2 }); }
}
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassMetadata(DropdownComponent, [{
        type: Component,
        args: [{ selector: 'app-dropdown', standalone: true, imports: [CommonModule], template: `
		<details
			class="dropdown"
			[attr.open]="isOpen ? '' : null"
			(mouseenter)="isOpen = true"
			(mouseleave)="isOpen = false"
		>
			<summary>Pages</summary>
			<nav class="menu">
				<a href="/">HTML</a>
				<a href="/react">React</a>
				<a href="/svelte">Svelte</a>
				<a href="/vue">Vue</a>
				<a href="/angular">Angular</a>
				<a href="/htmx">HTMX</a>
			</nav>
		</details>
	` }]
    }], null, null); })();
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassDebugInfo(DropdownComponent, { className: "DropdownComponent", filePath: "example/angular/components/dropdown.component.ts", lineNumber: 28 }); })();
