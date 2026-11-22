import type TS from 'typescript';
import { ts } from '../utils/lazyTypescript';

/** How many times code refers to `name`, outside import declarations:
 *  identifiers only, so a word in a string or a comment ("Home" in a
 *  link's label) never counts. The route-page splitters use it to tell a
 *  page used only by its route from one the file also uses elsewhere. */
export const identifierReferences = (file: TS.SourceFile, name: string) => {
	let count = 0;
	const visit = (node: TS.Node) => {
		if (ts.isImportDeclaration(node)) return;
		if (ts.isIdentifier(node) && node.text === name) count += 1;
		ts.forEachChild(node, visit);
	};
	visit(file);

	return count;
};

/** `identifierReferences` for a piece of source text. */
export const identifierReferencesIn = (source: string, name: string) =>
	source.includes(name)
		? identifierReferences(
				ts.createSourceFile(
					'absolute-references.ts',
					source,
					ts.ScriptTarget.Latest,
					true,
					ts.ScriptKind.TS
				),
				name
			)
		: 0;
