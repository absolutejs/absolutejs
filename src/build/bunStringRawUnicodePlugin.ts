import { extname } from 'node:path';
import type { BunPlugin, Loader } from 'bun';
import ts from 'typescript';

const NON_ASCII = /[^\x00-\x7f]/;

const getScriptKind = (filePath: string) => {
	if (/\.[cm]?tsx$/.test(filePath)) return ts.ScriptKind.TSX;
	if (/\.[cm]?jsx$/.test(filePath)) return ts.ScriptKind.JSX;
	if (/\.[cm]?ts$/.test(filePath)) return ts.ScriptKind.TS;

	return ts.ScriptKind.JS;
};

const getLoader = (filePath: string): Loader => {
	const extension = extname(filePath);
	if (extension === '.tsx') return 'tsx';
	if (extension === '.jsx') return 'jsx';
	if (extension === '.ts' || extension === '.mts' || extension === '.cts') {
		return 'ts';
	}

	return 'js';
};

const isStringRawTag = (node: ts.TaggedTemplateExpression) =>
	ts.isPropertyAccessExpression(node.tag) &&
	ts.isIdentifier(node.tag.expression) &&
	node.tag.expression.text === 'String' &&
	node.tag.name.text === 'raw';

const getRawText = (
	node:
		| ts.NoSubstitutionTemplateLiteral
		| ts.TemplateHead
		| ts.TemplateMiddle
		| ts.TemplateTail
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

	const visit = (node: ts.Node) => {
		if (ts.isTaggedTemplateExpression(node) && isStringRawTag(node)) {
			const rawSegments = ts.isNoSubstitutionTemplateLiteral(
				node.template
			)
				? [getRawText(node.template)]
				: [
						getRawText(node.template.head),
						...node.template.templateSpans.map((span) =>
							getRawText(span.literal)
						)
					];

			if (rawSegments.some((segment) => NON_ASCII.test(segment))) {
				const expressions = ts.isTemplateExpression(node.template)
					? node.template.templateSpans.map((span) => {
							const expression = source.slice(
								span.expression.getStart(sourceFile),
								span.expression.end
							);

							return rewriteBunStringRawUnicode(
								expression,
								filePath
							);
						})
					: [];
				const args = [
					`{ raw: [${rawSegments.map((text) => JSON.stringify(text)).join(', ')}] }`,
					...expressions
				];
				replacements.push({
					end: node.end,
					start: node.getStart(sourceFile),
					value: `String.raw(${args.join(', ')})`
				});

				return;
			}
		}

		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	let result = source;
	for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
		result =
			result.slice(0, replacement.start) +
			replacement.value +
			result.slice(replacement.end);
	}

	return result;
};

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
