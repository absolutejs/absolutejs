import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as i0 from "@angular/core";
export class CounterComponent {
    constructor() {
        this.initialCount = 0;
        this.count = 0;
    }
    ngOnInit() {
        this.count = this.initialCount;
    }
    increment() {
        this.count++;
    }
    static { this.ɵfac = function CounterComponent_Factory(__ngFactoryType__) { return new (__ngFactoryType__ || CounterComponent)(); }; }
    static { this.ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({ type: CounterComponent, selectors: [["app-counter"]], inputs: { initialCount: "initialCount" }, decls: 4, vars: 1, consts: [[3, "click"], [1, "counter-value"]], template: function CounterComponent_Template(rf, ctx) { if (rf & 1) {
            i0.ɵɵelementStart(0, "button", 0);
            i0.ɵɵlistener("click", function CounterComponent_Template_button_click_0_listener() { return ctx.increment(); });
            i0.ɵɵtext(1, " count is ");
            i0.ɵɵelementStart(2, "span", 1);
            i0.ɵɵtext(3);
            i0.ɵɵelementEnd()();
        } if (rf & 2) {
            i0.ɵɵadvance(3);
            i0.ɵɵtextInterpolate(ctx.count);
        } }, dependencies: [CommonModule], styles: ["button[_ngcontent-%COMP%] {\n\t\t\t\tbackground-color: #1a1a1a;\n\t\t\t\tborder: 1px solid transparent;\n\t\t\t\tborder-radius: 0.5rem;\n\t\t\t\tbox-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);\n\t\t\t\tcursor: pointer;\n\t\t\t\tfont-family: inherit;\n\t\t\t\tfont-size: 1.1rem;\n\t\t\t\tfont-weight: 500;\n\t\t\t\tmargin: 2rem 0;\n\t\t\t\tpadding: 0.6rem 1.2rem;\n\t\t\t\ttransition: border-color 0.25s;\n\t\t\t}\n\t\t\tbutton[_ngcontent-%COMP%]:hover {\n\t\t\t\tborder-color: #dd0031;\n\t\t\t}\n\t\t\tbutton[_ngcontent-%COMP%]:focus, \n\t\t\tbutton[_ngcontent-%COMP%]:focus-visible {\n\t\t\t\toutline: 4px auto -webkit-focus-ring-color;\n\t\t\t}\n\n\t\t\t@media (prefers-color-scheme: light) {\n\t\t\t\tbutton[_ngcontent-%COMP%] {\n\t\t\t\t\tbackground-color: #ffffff;\n\t\t\t\t}\n\t\t\t}"] }); }
}
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassMetadata(CounterComponent, [{
        type: Component,
        args: [{ selector: 'app-counter', standalone: true, imports: [CommonModule], template: `
		<button (click)="increment()">
			count is <span class="counter-value">{{ count }}</span>
		</button>
	`, styles: ["\n\t\t\tbutton {\n\t\t\t\tbackground-color: #1a1a1a;\n\t\t\t\tborder: 1px solid transparent;\n\t\t\t\tborder-radius: 0.5rem;\n\t\t\t\tbox-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);\n\t\t\t\tcursor: pointer;\n\t\t\t\tfont-family: inherit;\n\t\t\t\tfont-size: 1.1rem;\n\t\t\t\tfont-weight: 500;\n\t\t\t\tmargin: 2rem 0;\n\t\t\t\tpadding: 0.6rem 1.2rem;\n\t\t\t\ttransition: border-color 0.25s;\n\t\t\t}\n\t\t\tbutton:hover {\n\t\t\t\tborder-color: #dd0031;\n\t\t\t}\n\t\t\tbutton:focus,\n\t\t\tbutton:focus-visible {\n\t\t\t\toutline: 4px auto -webkit-focus-ring-color;\n\t\t\t}\n\n\t\t\t@media (prefers-color-scheme: light) {\n\t\t\t\tbutton {\n\t\t\t\t\tbackground-color: #ffffff;\n\t\t\t\t}\n\t\t\t}\n\t\t"] }]
    }], null, { initialCount: [{
            type: Input
        }] }); })();
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassDebugInfo(CounterComponent, { className: "CounterComponent", filePath: "example/angular/components/counter.component.ts", lineNumber: 44 }); })();
