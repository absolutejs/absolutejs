import type { JsonLdSchema, WithContext } from '../../types/jsonLd';

export const jsonLd = (schema: JsonLdSchema | JsonLdSchema[]) => {
	const data: WithContext<JsonLdSchema> | WithContext<JsonLdSchema>[] =
		Array.isArray(schema)
			? schema.map((s) => ({
					'@context': 'https://schema.org' as const,
					...s
				}))
			: { '@context': 'https://schema.org' as const, ...schema };

	return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
};
