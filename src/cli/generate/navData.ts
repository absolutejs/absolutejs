import ts from 'typescript';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// The generator's single source of truth for cross-page navigation. JS-framework
// pages import `navData` and render it live (so they stay in sync automatically);
// static HTML/HTMX pages bake a snapshot between markers that is re-synced on each
// generate. This module reads, creates, and idempotently appends to the file —
// editing the array literal by text-splicing around AST node positions so any
// hand-edits to the file's formatting survive.

export type NavItem = {
	href: string;
	label: string;
};

const NAV_DATA_TEMPLATE = `type NavItem = {
	href: string;
	label: string;
};

export const navData: NavItem[] = [];
`;

const findNavArray = (sourceFile: ts.SourceFile) => {
	let found: ts.ArrayLiteralExpression | null = null;

	const visit = (node: ts.Node) => {
		if (found) return;
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === 'navData' &&
			node.initializer &&
			ts.isArrayLiteralExpression(node.initializer)
		) {
			found = node.initializer;

			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	return found;
};

const readStringProperty = (
	object: ts.ObjectLiteralExpression,
	name: string
) => {
	const property = object.properties.find(
		(candidate): candidate is ts.PropertyAssignment =>
			ts.isPropertyAssignment(candidate) &&
			ts.isIdentifier(candidate.name) &&
			candidate.name.text === name
	);
	if (!property || !ts.isStringLiteralLike(property.initializer)) {
		return null;
	}

	return property.initializer.text;
};

const parseNavItems = (array: ts.ArrayLiteralExpression) => {
	const items: NavItem[] = [];
	for (const element of array.elements) {
		if (!ts.isObjectLiteralExpression(element)) continue;
		const href = readStringProperty(element, 'href');
		const label = readStringProperty(element, 'label');
		if (href !== null && label !== null) items.push({ href, label });
	}

	return items;
};

export const readNavItems = (navDataPath: string) => {
	if (!existsSync(navDataPath)) return [];
	const text = readFileSync(navDataPath, 'utf-8');
	const sourceFile = ts.createSourceFile(
		navDataPath,
		text,
		ts.ScriptTarget.Latest,
		true
	);
	const array = findNavArray(sourceFile);

	return array ? parseNavItems(array) : [];
};

const indentOf = (text: string, position: number) => {
	let index = position;
	while (index > 0 && text[index - 1] !== '\n') index -= 1;
	let end = index;
	while (text[end] === ' ' || text[end] === '\t') end += 1;

	return text.slice(index, end);
};

const insertElement = (
	text: string,
	array: ts.ArrayLiteralExpression,
	sourceFile: ts.SourceFile,
	entry: string
) => {
	const { elements } = array;
	if (elements.length === 0) {
		const insertAt = array.getStart(sourceFile) + 1;
		const indent = `${indentOf(text, array.getStart(sourceFile))}\t`;
		const insertion = `\n${indent}${entry}\n${indentOf(text, array.getStart(sourceFile))}`;

		return text.slice(0, insertAt) + insertion + text.slice(insertAt);
	}

	const last = elements[elements.length - 1];
	if (!last) return text;
	const indent = indentOf(text, last.getStart(sourceFile));
	let insertAt = last.getEnd();
	const hasComma = text[insertAt] === ',';
	if (hasComma) insertAt += 1;
	const insertion = `${hasComma ? '' : ','}\n${indent}${entry}`;

	return text.slice(0, insertAt) + insertion + text.slice(insertAt);
};

// Adds `{ href, label }` to navData (creating the file if needed), skipping the
// write when an item with the same href already exists. Returns the full list
// after the upsert plus whether the file was created or changed.
export const upsertNavItem = (navDataPath: string, item: NavItem) => {
	const created = !existsSync(navDataPath);
	if (created) {
		mkdirSync(dirname(navDataPath), { recursive: true });
		writeFileSync(navDataPath, NAV_DATA_TEMPLATE, 'utf-8');
	}

	const existing = readNavItems(navDataPath);
	if (existing.some((candidate) => candidate.href === item.href)) {
		return { changed: created, created, items: existing };
	}

	const text = readFileSync(navDataPath, 'utf-8');
	const sourceFile = ts.createSourceFile(
		navDataPath,
		text,
		ts.ScriptTarget.Latest,
		true
	);
	const array = findNavArray(sourceFile);
	if (!array) return { changed: created, created, items: existing };

	const entry = `{ href: '${item.href}', label: '${item.label}' }`;
	writeFileSync(
		navDataPath,
		insertElement(text, array, sourceFile, entry),
		'utf-8'
	);

	return { changed: true, created, items: [...existing, item] };
};
