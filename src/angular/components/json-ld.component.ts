import {
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	inject,
	Input,
	Renderer2
} from '@angular/core';

/* A schema.org thing. Any `JsonLdSchema` is one. The package's own
 * types are not imported, type or not: this directory is compiled apart
 * from the rest of the package, where `types/` cannot be found. */
type JsonLdThing = { '@type': string; [property: string]: unknown };

const SCHEMA_ORG = 'https://schema.org';
const UNSAFE_IN_SCRIPT: Record<string, string> = {
	'\u2028': '\\u2028',
	'\u2029': '\\u2029',
	'<': '\\u003C'
};

/** Structured data for the page, as a JSON-LD script:
 *
 *    <absolute-json-ld [schema]="{ '@type': 'Article', headline: title }" />
 *
 *  Angular's template compiler drops a `<script>` written in a template
 *  without a word, so the element is made by hand, inside this
 *  component's own. It is rendered on the server, where a crawler reads
 *  it, and replaced in the browser when `schema` changes.
 *
 *  For a file route, `metadata.jsonLd` in the route's server module
 *  puts it in the head instead. */
@Component({
	changeDetection: ChangeDetectionStrategy.OnPush,
	selector: 'absolute-json-ld',
	standalone: true,
	template: ''
})
export class JsonLdComponent {
	private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

	private readonly renderer = inject(Renderer2);

	/* A setter and not a signal input: the element is written when the
	 * value arrives, on the server as in the browser, with nothing to
	 * wait for. */
	@Input({ required: true })
	set schema(schema: JsonLdThing | JsonLdThing[]) {
		const element = this.host.nativeElement;
		// The server's, found again after hydration, and any earlier
		// one of this component's own.
		Array.from(element.childNodes).forEach((child) =>
			this.renderer.removeChild(element, child)
		);
		const script: HTMLScriptElement = this.renderer.createElement('script');
		this.renderer.setAttribute(script, 'type', 'application/ld+json');
		this.renderer.appendChild(
			script,
			this.renderer.createText(jsonLdText(schema))
		);
		this.renderer.appendChild(element, script);
	}
}

/** The text of a JSON-LD script for `schema`: several schemas as one
 *  `@graph`, and `<` escaped so no value can end the script. Written
 *  here and not imported, because this directory is compiled apart from
 *  the rest of the package. */
export const jsonLdText = (schema: JsonLdThing | JsonLdThing[]) =>
	JSON.stringify(
		Array.isArray(schema)
			? { '@context': SCHEMA_ORG, '@graph': schema }
			: { '@context': SCHEMA_ORG, ...schema }
	).replace(/[<\u2028\u2029]/g, (char) => UNSAFE_IN_SCRIPT[char] ?? char);
