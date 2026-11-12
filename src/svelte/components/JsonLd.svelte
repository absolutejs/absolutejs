<script lang="ts">
	import type { JsonLdSchema, WithContext } from '../../../types/jsonLd';

	let { schema }: { schema: JsonLdSchema | JsonLdSchema[] } = $props();
	const schemaOrgContext = 'https://schema.org';

	const data = $derived<
		WithContext<JsonLdSchema> | WithContext<JsonLdSchema>[]
	>(
		Array.isArray(schema)
			? schema.map((s) => ({
					'@context': schemaOrgContext,
					...s
				}))
			: { '@context': schemaOrgContext, ...schema }
	);
	// `<` is escaped so a value can't close the script tag early; the JSON
	// is unchanged once parsed.
	const json = $derived(
		JSON.stringify(data)
			.replaceAll('<', '\\u003C')
			.replaceAll('\u2028', '\\u2028')
			.replaceAll('\u2029', '\\u2029')
	);
</script>

<svelte:head>
	{@html `<script type="application/ld+json">${json}</script>`}
</svelte:head>
