// Naming helpers for the page/component/api generators. A single raw name
// (e.g. "user-settings", "userSettings", "User Settings") is normalized into
// the three forms the generators need: PascalCase identifiers/manifest keys,
// kebab-case route paths/file stems, and a human label for nav.

// Split a raw name into lowercased word tokens, breaking on separators and
// camelCase / acronym boundaries so every input shape lands on the same words.
const tokenize = (raw: string) =>
	raw
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.split(/[^a-zA-Z0-9]+/)
		.filter((token) => token.length > 0)
		.map((token) => token.toLowerCase());

const capitalize = (word: string) =>
	word.charAt(0).toUpperCase() + word.slice(1);

export const isValidName = (raw: string | undefined): raw is string =>
	typeof raw === 'string' && tokenize(raw).length > 0;
export const toCamelCase = (raw: string) => {
	const pascal = toPascalCase(raw);

	return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};
export const toKebabCase = (raw: string) => tokenize(raw).join('-');
export const toPascalCase = (raw: string) =>
	tokenize(raw).map(capitalize).join('');
export const toTitleCase = (raw: string) =>
	tokenize(raw).map(capitalize).join(' ');
