import { extname } from 'node:path';
import type { BunPlugin } from 'bun';
import type TS from 'typescript';
import { ts } from '../utils/lazyTypescript';

/* Any UTF-16 code unit above ASCII. Written as the range it matches, not
 * as "not ASCII", so the pattern holds no control characters. */
const NON_ASCII = /[\u0080-\uffff]/;

const getScriptKind = (filePath: string) => {
	if (/\.[cm]?tsx$/.test(filePath)) return ts.ScriptKind.TSX;
	if (/\.[cm]?jsx$/.test(filePath)) return ts.ScriptKind.JSX;
	if (/\.[cm]?ts$/.test(filePath)) return ts.ScriptKind.TS;

	return ts.ScriptKind.JS;
};

const getLoader = (filePath: string) => {
	const extension = extname(filePath);
	if (extension === '.tsx') return 'tsx';
	if (extension === '.jsx') return 'jsx';
	if (extension === '.ts' || extension === '.mts' || extension === '.cts') {
		return 'ts';
	}

	return 'js';
};

const isStringRawTag = (node: TS.TaggedTemplateExpression) =>
	ts.isPropertyAccessExpression(node.tag) &&
	ts.isIdentifier(node.tag.expression) &&
	node.tag.expression.text === 'String' &&
	node.tag.name.text === 'raw';

const getRawText = (
	node:
		| TS.NoSubstitutionTemplateLiteral
		| TS.TemplateHead
		| TS.TemplateMiddle
		| TS.TemplateTail
) => node.rawText ?? node.text;

/**
 * Work around oven-sh/bun#16763. With target "bun", Bun escapes non-ASCII
 * characters inside tagged templates. String.raw then observes the generated
 * escape text instead of the character that was present in source.
 *
 * `String.raw` is specified in terms of a first argument with a `raw` array,
 * so spelling the same operation as a normal call avoids the faulty tagged
 * template transform without changing backslashes or substitutions.
 */
export const createBunStringRawUnicodePlugin = (): BunPlugin => ({
	name: 'absolute-bun-string-raw-unicode',
	setup(build) {
		build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
			if (args.path.includes('/node_modules/')) return undefined;
			const source = await Bun.file(args.path).text();
			const contents = rewriteBunStringRawUnicode(source, args.path);
			if (contents === source) return undefined;

			return { contents, loader: getLoader(args.path) };
		});
	}
});
export const rewriteBunStringRawUnicode = (
	source: string,
	filePath = 'input.ts'
) => {
	if (!source.includes('String.raw') || !NON_ASCII.test(source))
		return source;

	const sourceFile = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		getScriptKind(filePath)
	);
	const replacements: { end: number; start: number; value: string }[] = [];

	/* The call that replaces one `String.raw` template, or nothing when
	 * the template is plain ASCII and Bun handles it as written. */
	const replacementFor = (node: TS.TaggedTemplateExpression) => {
		const rawSegments = ts.isNoSubstitutionTemplateLiteral(node.template)
			? [getRawText(node.template)]
			: [
					getRawText(node.template.head),
					...node.template.templateSpans.map((span) =>
						getRawText(span.literal)
					)
				];
		if (!rawSegments.some((segment) => NON_ASCII.test(segment)))
			return undefined;

		const expressions = ts.isTemplateExpression(node.template)
			? node.template.templateSpans.map((span) => {
					const expression = source.slice(
						span.expression.getStart(sourceFile),
						span.expression.end
					);

					return rewriteBunStringRawUnicode(expression, filePath);
				})
			: [];
		const args = [
			`{ raw: [${rawSegments.map((text) => JSON.stringify(text)).join(', ')}] }`,
			...expressions
		];

		return {
			end: node.end,
			start: node.getStart(sourceFile),
			value: `String.raw(${args.join(', ')})`
		};
	};

	const visit = (node: TS.Node) => {
		const replacement =
			ts.isTaggedTemplateExpression(node) && isStringRawTag(node)
				? replacementFor(node)
				: undefined;
		if (replacement === undefined) ts.forEachChild(node, visit);
		else replacements.push(replacement);
	};

	visit(sourceFile);
	let result = source;
	for (const replacement of replacements.sort(
		(left, right) => right.start - left.start
	)) {
		result =
			result.slice(0, replacement.start) +
			replacement.value +
			result.slice(replacement.end);
	}

	return result;
};
