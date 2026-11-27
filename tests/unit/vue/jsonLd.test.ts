import { describe, expect, test } from 'bun:test';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { JsonLd } from '../../../src/vue/components/JsonLd';
import type { JsonLdSchema } from '../../../types/jsonLd';

const render = (schema: JsonLdSchema | JsonLdSchema[]) =>
	renderToString(createSSRApp(JsonLd, { schema }));

describe('Vue JsonLd', () => {
	test('renders the schema as a JSON-LD script', async () => {
		expect(await render({ '@type': 'Article', headline: 'Post' })).toBe(
			'<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Post"}</script>'
		);
	});

	test('escapes what would end the script', async () => {
		expect(
			await render({ '@type': 'Article', headline: 'A </script> B' })
		).toContain('"headline":"A \\u003C/script> B"');
	});

	test('writes several schemas as one graph', async () => {
		expect(
			await render([
				{ '@type': 'WebSite', name: 'Acme', url: 'https://acme.test' },
				{ '@type': 'Article', headline: 'Post' }
			])
		).toContain('"@graph":[{"@type":"WebSite"');
	});
});
