const ESCAPE_LOOKUP: Record<string, string> = {
	'\u2028': '\\u2028',
	'\u2029': '\\u2029',
	'<': '\\u003C'
};

const ESCAPE_REGEX = /[<\u2028\u2029]/g;

export const escapeScriptContent = (content: string) =>
	content.replace(ESCAPE_REGEX, (char) => {
		const escaped = ESCAPE_LOOKUP[char];

		return escaped !== undefined ? escaped : char;
	});
