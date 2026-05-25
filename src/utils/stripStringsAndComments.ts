/**
 * Strip string literals (single-quote, double-quote, and template — including
 * `${}` interpolations and nested templates) plus comments (line and block)
 * from TypeScript/JavaScript source, returning only the code that lives
 * outside those contexts.
 *
 * Heuristic content checks — e.g. "is this a real Angular `@Component`
 * source?" — must run against the result, not the raw text. A naive regex
 * strip mis-pairs quotes whenever a quote or backtick appears inside a
 * differently-quoted string or a comment (inline-code backticks in JSDoc, an
 * apostrophe in a comment, a backtick inside a single-quoted string), leaving
 * the matched text behind and producing false positives.
 *
 * Regex literals are intentionally left intact: telling `/` division apart
 * from a regex needs a full parser, and their contents have never mattered for
 * the checks this supports.
 */
export const stripStringsAndComments = (source: string) => {
	const { length } = source;
	// Stack of nested string contexts. A `0` entry is template-literal text; a
	// positive entry is the open-brace depth of a `${ }` interpolation. An
	// empty stack means top-level code — the only place characters are emitted.
	const stack: number[] = [];
	let result = '';
	let index = 0;

	const top = () => stack[stack.length - 1];

	const skipLineComment = () => {
		index += 2;
		while (index < length && source.charAt(index) !== '\n') index += 1;
	};

	const skipBlockComment = () => {
		index += 2;
		while (
			index < length &&
			!(source.charAt(index) === '*' && source.charAt(index + 1) === '/')
		)
			index += 1;
		index += 2;
	};

	const skipQuoted = (quote: string) => {
		index += 1;
		while (index < length && source.charAt(index) !== quote)
			index += source.charAt(index) === '\\' ? 2 : 1;
		index += 1;
	};

	const startCommentOrString = () => {
		const char = source.charAt(index);
		const next = source.charAt(index + 1);
		const isLine = char === '/' && next === '/';
		const isBlock = char === '/' && next === '*';
		const isQuote = char === "'" || char === '"';
		if (isLine) skipLineComment();
		else if (isBlock) skipBlockComment();
		else if (isQuote) skipQuoted(char);

		return isLine || isBlock || isQuote;
	};

	const pushTemplate = () => {
		stack.push(0);
		index += 1;
	};

	const openBrace = () => {
		stack.push((stack.pop() ?? 0) + 1);
		index += 1;
	};

	const closeBrace = () => {
		const depth = (stack.pop() ?? 0) - 1;
		index += 1;
		if (depth > 0) stack.push(depth);
	};

	const handleTopLevel = () => {
		if (startCommentOrString()) return;
		if (source.charAt(index) === '`') pushTemplate();
		else {
			result += source.charAt(index);
			index += 1;
		}
	};

	const handleTemplateText = () => {
		const char = source.charAt(index);
		if (char === '\\') index += 2;
		else if (char === '`') {
			stack.pop();
			index += 1;
		} else if (char === '$' && source.charAt(index + 1) === '{') {
			stack.push(1);
			index += 2;
		} else index += 1;
	};

	const handleInterp = () => {
		if (startCommentOrString()) return;
		const char = source.charAt(index);
		if (char === '`') pushTemplate();
		else if (char === '{') openBrace();
		else if (char === '}') closeBrace();
		else index += 1;
	};

	const step = () => {
		const frame = top();
		if (frame === undefined) handleTopLevel();
		else if (frame === 0) handleTemplateText();
		else handleInterp();
	};

	while (index < length) step();

	return result;
};
