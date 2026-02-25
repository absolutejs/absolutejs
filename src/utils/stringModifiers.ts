const normalizeSlug = (str: string) =>
	str
		.trim()
		.replace(/\s+/g, '-')
		.replace(/[^A-Za-z0-9\-_]+/g, '')
		.replace(/[-_]{2,}/g, '-');

export const toPascal = (str: string) => {
	if (!str.includes('-') && !str.includes('_')) {
		return str.charAt(0).toUpperCase() + str.slice(1);
	}

	return normalizeSlug(str)
		.split(/[-_]/)
		.filter(Boolean)
		.map(
			(segment) =>
				segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase()
		)
		.join('');
};

export const toKebab = (str: string) =>
	normalizeSlug(str)
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.toLowerCase();

export const toScreamingSnake = (str: string) =>
	str.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
