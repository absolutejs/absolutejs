import type { JsonLdSchema, WithContext } from '../../types/jsonLd';

export const jsonLd = (schema: JsonLdSchema | JsonLdSchema[]) =>
	`<script type="application/ld+json">${serializeJsonLd(schema)}</script>`;
export const serializeJsonLd = (schema: JsonLdSchema | JsonLdSchema[]) => {
	const schemaOrgContext = 'https://schema.org';
	const data: WithContext<JsonLdSchema> | WithContext<JsonLdSchema>[] =
		Array.isArray(schema)
			? schema.map((s) => ({
					'@context': schemaOrgContext,
					...s
				}))
			: { '@context': schemaOrgContext, ...schema };

	return JSON.stringify(data);
};
