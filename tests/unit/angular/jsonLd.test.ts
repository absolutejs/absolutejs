import '@angular/compiler';
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import {
	provideServerRendering,
	renderApplication
} from '@angular/platform-server';
import {
	JsonLdComponent,
	jsonLdText
} from '../../../src/angular/components/json-ld.component';
import type { JsonLdSchema } from '../../../types/jsonLd';

/* Angular's template compiler drops a `<script>` written in a template,
 * so the component makes the element by hand. What matters is that it
 * is in the HTML the server sends, which is rendered here for real. */

const ARTICLE: JsonLdSchema = { '@type': 'Article', headline: 'A </script> B' };

@Component({
	imports: [JsonLdComponent],
	selector: 'app-root',
	standalone: true,
	template: '<main>page</main><absolute-json-ld [schema]="schema" />'
})
class HostComponent {
	readonly schema = ARTICLE;
}

const render = () =>
	renderApplication(
		(context) =>
			bootstrapApplication(
				HostComponent,
				{
					providers: [
						provideServerRendering(),
						provideZonelessChangeDetection()
					]
				},
				context
			),
		{
			document:
				'<html><head></head><body><app-root></app-root></body></html>'
		}
	);

describe('Angular JsonLdComponent', () => {
	test('writes the script into the server’s HTML', async () => {
		const html = await render();

		expect(html).toContain(
			'<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"A \\u003C/script> B"}</script>'
		);
	});

	test('writes several schemas as one graph', () => {
		expect(
			jsonLdText([
				{ '@type': 'WebSite', name: 'Acme', url: 'https://acme.test' },
				ARTICLE
			])
		).toStartWith(
			'{"@context":"https://schema.org","@graph":[{"@type":"WebSite"'
		);
	});

	test('stays inside its own directory for the partial compile', () => {
		const source = readFileSync(
			resolve(
				import.meta.dir,
				'../../../src/angular/components/json-ld.component.ts'
			),
			'utf8'
		);

		// A type import is erased; anything else from outside the
		// directory would be published as an import of a missing file.
		expect(source.match(/^import (?!type )[^;]*from '[^']+'/gms)).toEqual([
			expect.stringContaining("from '@angular/core'")
		]);
	});
});
