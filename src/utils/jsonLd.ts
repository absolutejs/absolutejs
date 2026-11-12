import { escapeScriptContent } from './escapeScriptContent';
import type { JsonLdSchema, WithContext } from '../../types/jsonLd';

type JsonLdGraph = {
	'@context': 'https://schema.org';
	'@graph': JsonLdSchema[];
};

export const jsonLd = (schema: JsonLdSchema | JsonLdSchema[]) =>
	`<script type="application/ld+json">${serializeJsonLd(schema)}</script>`;
export const serializeJsonLd = (schema: JsonLdSchema | JsonLdSchema[]) => {
	const schemaOrgContext = 'https://schema.org';
	const data: WithContext<JsonLdSchema> | JsonLdGraph = Array.isArray(schema)
		? { '@context': schemaOrgContext, '@graph': schema }
		: { '@context': schemaOrgContext, ...schema };

	// Escaped so a value containing `</script>` can't end the tag.
	return escapeScriptContent(JSON.stringify(data));
};
