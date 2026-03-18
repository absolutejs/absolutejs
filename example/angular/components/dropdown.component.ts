import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
	imports: [CommonModule],
	selector: 'app-dropdown',
	standalone: true,
	templateUrl: '../templates/dropdown.component.html'
})
export class DropdownComponent {
	isOpen = false;
}
