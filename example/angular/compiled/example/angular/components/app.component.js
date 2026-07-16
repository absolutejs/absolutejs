import { Component, Input, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CounterComponent } from './counter.component.js';
import * as i0 from "@angular/core";
export class AppComponent {
    constructor() {
        this.initialCount = 0;
    }
    static { this.ɵfac = function AppComponent_Factory(__ngFactoryType__) { return new (__ngFactoryType__ || AppComponent)(); }; }
    static { this.ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({ type: AppComponent, selectors: [["app-root"]], inputs: { initialCount: "initialCount" }, decls: 18, vars: 1, consts: [["href", "https://absolutejs.com", "target", "_blank"], ["src", "/assets/png/absolutejs-temp.png", "alt", "AbsoluteJS Logo", 1, "logo"], ["href", "https://angular.dev/"], ["src", "/assets/svg/angular.svg", "alt", "Angular Logo", 1, "logo", "angular"], [3, "initialCount"], [2, "margin-top", "2rem"], [2, "color", "#777", "font-size", "1rem", "margin-top", "2rem"]], template: function AppComponent_Template(rf, ctx) { if (rf & 1) {
            i0.ɵɵelementStart(0, "main")(1, "nav")(2, "a", 0);
            i0.ɵɵelement(3, "img", 1);
            i0.ɵɵelementEnd();
            i0.ɵɵelementStart(4, "a", 2);
            i0.ɵɵelement(5, "img", 3);
            i0.ɵɵelementEnd()();
            i0.ɵɵelementStart(6, "h1");
            i0.ɵɵtext(7, "AbsoluteJS + Angular");
            i0.ɵɵelementEnd();
            i0.ɵɵelement(8, "app-counter", 4);
            i0.ɵɵelementStart(9, "p");
            i0.ɵɵtext(10, " Edit ");
            i0.ɵɵelementStart(11, "code");
            i0.ɵɵtext(12, "example/angular/pages/angular-example.ts");
            i0.ɵɵelementEnd();
            i0.ɵɵtext(13, " and save to test HMR. ");
            i0.ɵɵelementEnd();
            i0.ɵɵelementStart(14, "p", 5);
            i0.ɵɵtext(15, " Explore the other pages to see how AbsoluteJS seamlessly unifies multiple frameworks on a single server. ");
            i0.ɵɵelementEnd();
            i0.ɵɵelementStart(16, "p", 6);
            i0.ɵɵtext(17, " Click on the AbsoluteJS and Angular logos to learn more. ");
            i0.ɵɵelementEnd()();
        } if (rf & 2) {
            i0.ɵɵadvance(8);
            i0.ɵɵproperty("initialCount", ctx.initialCount);
        } }, dependencies: [CommonModule, CounterComponent], styles: ["code {\n\tbackground-color: #1a1a1a;\n\tpadding: 0.2rem 0.4rem;\n\tborder-radius: 0.25rem;\n\tfont-size: 0.9em;\n}\n\n@media (prefers-color-scheme: light) {\n\tcode {\n\t\tbackground-color: #f0f0f0;\n\t}\n}\n"], encapsulation: 2 }); }
}
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassMetadata(AppComponent, [{
        type: Component,
        args: [{ selector: 'app-root', standalone: true, imports: [CommonModule, CounterComponent], encapsulation: ViewEncapsulation.None // Allow global styles to apply
                , template: "<main>\n\t<nav>\n\t\t<a href=\"https://absolutejs.com\" target=\"_blank\">\n\t\t\t<img\n\t\t\t\tclass=\"logo\"\n\t\t\t\tsrc=\"/assets/png/absolutejs-temp.png\"\n\t\t\t\talt=\"AbsoluteJS Logo\"\n\t\t\t/>\n\t\t</a>\n\t\t<a href=\"https://angular.dev/\">\n\t\t\t<img\n\t\t\t\tclass=\"logo angular\"\n\t\t\t\tsrc=\"/assets/svg/angular.svg\"\n\t\t\t\talt=\"Angular Logo\"\n\t\t\t/>\n\t\t</a>\n\t</nav>\n\t<h1>AbsoluteJS + Angular</h1>\n\t<app-counter [initialCount]=\"initialCount\"></app-counter>\n\t<p>\n\t\tEdit <code>example/angular/pages/angular-example.ts</code> and save to\n\t\ttest HMR.\n\t</p>\n\t<p style=\"margin-top: 2rem\">\n\t\tExplore the other pages to see how AbsoluteJS seamlessly unifies\n\t\tmultiple frameworks on a single server.\n\t</p>\n\t<p style=\"color: #777; font-size: 1rem; margin-top: 2rem\">\n\t\tClick on the AbsoluteJS and Angular logos to learn more.\n\t</p>\n</main>\n", styles: ["code {\n\tbackground-color: #1a1a1a;\n\tpadding: 0.2rem 0.4rem;\n\tborder-radius: 0.25rem;\n\tfont-size: 0.9em;\n}\n\n@media (prefers-color-scheme: light) {\n\tcode {\n\t\tbackground-color: #f0f0f0;\n\t}\n}\n"] }]
    }], null, { initialCount: [{
            type: Input
        }] }); })();
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassDebugInfo(AppComponent, { className: "AppComponent", filePath: "example/angular/components/app.component.ts", lineNumber: 13 }); })();
