import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
	selector: 'app-head',
	standalone: true,
	imports: [CommonModule],
	template: `
		<head>
			<meta charset="UTF-8" />
			<link
				rel="icon"
				type="image/x-icon"
				href="/assets/ico/favicon.ico"
			/>
			<meta
				name="viewport"
				content="width=device-width, initial-scale=1.0"
			/>
			<title>AbsoluteJS</title>
			<link rel="stylesheet" [href]="safeCssPath" />
		</head>
	`
})
export class HeadComponent implements OnChanges {
	@Input() cssPath: string = '';
	safeCssPath: SafeResourceUrl | string = '';
	
	constructor(private sanitizer: DomSanitizer) {}
	
	ngOnChanges(changes: SimpleChanges) {
		// Sanitize the CSS path to allow it as a resource URL
		// Since we control the CSS path (from manifest), it's safe to bypass sanitization
		if (this.cssPath) {
			this.safeCssPath = this.sanitizer.bypassSecurityTrustResourceUrl(this.cssPath);
		} else {
			this.safeCssPath = '';
		}
	}
}

