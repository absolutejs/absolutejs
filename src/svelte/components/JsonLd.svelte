<script lang="ts">
	import type { JsonLdSchema, WithContext } from '../../../types/jsonLd';

	let { schema }: { schema: JsonLdSchema | JsonLdSchema[] } = $props();

	const data = $derived<
		WithContext<JsonLdSchema> | WithContext<JsonLdSchema>[]
	>(
		Array.isArray(schema)
			? schema.map((s) => ({
					'@context': 'https://schema.org' as const,
					...s
				}))
			: { '@context': 'https://schema.org' as const, ...schema }
	);
</script>

<svelte:head>
	{@html `<script type="application/ld+json">${JSON.stringify(data)}</script>`}
</svelte:head>
