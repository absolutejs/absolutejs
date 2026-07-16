var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
let DropdownComponent = class DropdownComponent {
    isOpen = false;
};
DropdownComponent = __decorate([
    Component({
        selector: 'app-dropdown',
        standalone: true,
        imports: [CommonModule],
        template: `
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
	`,
        styles: []
    })
], DropdownComponent);
export { DropdownComponent };
