import type { JsonLdSchema, WithContext } from '../../../types/jsonLd';

export const JsonLd = ({
	schema
}: {
	schema: JsonLdSchema | JsonLdSchema[];
}) => {
	const data: WithContext<JsonLdSchema> | WithContext<JsonLdSchema>[] =
		Array.isArray(schema)
			? schema.map((s) => ({
					'@context': 'https://schema.org' as const,
					...s
				}))
			: { '@context': 'https://schema.org' as const, ...schema };

	return (
		<script
			dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
			type="application/ld+json"
		/>
	);
};
