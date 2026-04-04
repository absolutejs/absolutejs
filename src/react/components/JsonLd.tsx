import type { JsonLdSchema, WithContext } from '../../../types/jsonLd';

export const JsonLd = ({
	schema
}: {
	schema: JsonLdSchema | JsonLdSchema[];
}) => {
	const schemaOrgContext = 'https://schema.org';
	const data: WithContext<JsonLdSchema> | WithContext<JsonLdSchema>[] =
		Array.isArray(schema)
			? schema.map((s) => ({
					'@context': schemaOrgContext,
					...s
				}))
			: { '@context': schemaOrgContext, ...schema };

	return (
		<script
			dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
			type="application/ld+json"
		/>
	);
};
