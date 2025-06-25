const ESCAPE_LOOKUP: Record<string, string> = {
	"\u2028": "\\u2028",
	"\u2029": "\\u2029",
	"&": "\\u0026",
	"<": "\\u003C",
	">": "\\u003E"
};

const ESCAPE_REGEX = /[&><\u2028\u2029]/g;

export const escapeScriptContent = (content: string) =>
	content.replace(ESCAPE_REGEX, (char) => ESCAPE_LOOKUP[char]);
