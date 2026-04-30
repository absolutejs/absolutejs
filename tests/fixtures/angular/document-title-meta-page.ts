import '@angular/compiler';
import { defineAngularPage } from '../../../src/angular/page';
import { DOCUMENT } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

@Component({
	selector: 'document-title-meta-ssr-test-page',
	standalone: true,
	template: `
		<p id="document-body-tag">{{ bodyTag }}</p>
		<p id="document-title-value">{{ titleValue }}</p>
	`
})
class DocumentTitleMetaSsrTestPage {
	private readonly document = inject(DOCUMENT);
	private readonly meta = inject(Meta);
	private readonly title = inject(Title);
	readonly bodyTag = this.document.body.tagName.toLowerCase();
	readonly titleValue = 'Angular document title';

	ngOnInit() {
		this.title.setTitle(this.titleValue);
		this.meta.updateTag({
			content: 'Angular SSR meta description',
			name: 'description'
		});
	}
}

export const page = defineAngularPage({
	component: DocumentTitleMetaSsrTestPage
});
