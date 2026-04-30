import '@angular/compiler';
import { defineAngularPage } from '../../../src/angular/page';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { provideAnimations } from '@angular/platform-browser/animations';

@Component({
	selector: 'material-dialog-content',
	standalone: true,
	template: '<p id="material-dialog-content">material dialog content</p>'
})
class MaterialDialogContent {}

@Component({
	imports: [MatButtonModule, MatCardModule, MatDialogModule],
	selector: 'material-ssr-test-page',
	standalone: true,
	template: `
		<mat-card>
			<mat-card-title>Material SSR</mat-card-title>
			<mat-card-content>
				<p id="material-card-content">material card content</p>
				<p id="material-dialog-state">{{ dialogState() }}</p>
				<button matButton="filled" type="button">
					Material button
				</button>
			</mat-card-content>
		</mat-card>
	`
})
class MaterialSsrTestPage {
	private readonly dialog = inject(MatDialog);
	readonly dialogState = signal('closed');

	ngOnInit() {
		this.dialog.open(MaterialDialogContent, {
			autoFocus: false,
			restoreFocus: false
		});
		this.dialogState.set('opened');
	}
}

export const providers = [provideAnimations()];

export const page = defineAngularPage({ component: MaterialSsrTestPage });
