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
</script>

<svelte:head>
	{@html `<script type="application/ld+json">${JSON.stringify(data)}</script>`}
</svelte:head>
