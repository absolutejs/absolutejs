import { defineComponent, h } from 'vue';
import { serializeJsonLd } from '../../utils/jsonLd';
import type { JsonLdSchema } from '../../../types/jsonLd';

type JsonLdProps = { schema: JsonLdSchema | JsonLdSchema[] };

/** Structured data for the page, as a JSON-LD script:
 *
 *    <JsonLd :schema="{ '@type': 'Article', headline: post.title }" />
 *
 *  Rendered where it is written. JSON-LD is read wherever it is in the
 *  document, and a Vue page's head has been sent by the time its
 *  component renders. For a file route, `metadata.jsonLd` in the route's
 *  server module puts it in the head instead.
 *
 *  Several schemas are written as one `@graph`. A `<` in a value is
 *  escaped, so no value can end the script. */
export const JsonLd = defineComponent({
	name: 'AbsoluteJsonLd',
	props: {
		schema: {
			required: true,
			type: [Object, Array]
		}
	},
	setup(props: JsonLdProps) {
		return () =>
			h('script', {
				innerHTML: serializeJsonLd(props.schema),
				type: 'application/ld+json'
			});
	}
});
