import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { findConfigObject } from './resolveAbsoluteConfig';
import type { AbsoluteConfigEditRequest } from '../../../../types/absoluteConfig';

const serializeValue = (value: unknown) => {
	if (typeof value === 'string') {
		return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}

	return JSON.stringify(value);
};

const lineStartOffset = (text: string, position: number) => {
	let index = position;
	while (index > 0 && text[index - 1] !== '\n') index -= 1;

	return index;
};

const indentBefore = (text: string, position: number) =>
	text.slice(lineStartOffset(text, position), position);

const findProperty = (object: ts.ObjectLiteralExpression, name: string) =>
	object.properties.find(
		(property): property is ts.PropertyAssignment =>
			ts.isPropertyAssignment(property) &&
			(ts.isIdentifier(property.name) ||
				ts.isStringLiteral(property.name)) &&
			property.name.text === name
	);

// Edits the `defineConfig({...})` object literal by splicing the source text
// around TypeScript AST node positions — so imports, comments, and the rest of
// the file are untouched. Only scalar values are written here.
export const applyAbsoluteConfigEdit = (
	configPath: string,
	request: AbsoluteConfigEditRequest
) => {
	try {
		const text = readFileSync(configPath, 'utf-8');
		const sourceFile = ts.createSourceFile(
			configPath,
			text,
			ts.ScriptTarget.Latest,
			true
		);
		const object = findConfigObject(sourceFile);
		if (!object) {
			return {
				message:
					'Could not find defineConfig({ ... }) in the config file.',
				ok: false
			};
		}

		const existing = findProperty(object, request.name);

		if (request.remove) {
			if (!existing)
				return { message: `${request.name} is not set`, ok: true };
			const start = lineStartOffset(text, existing.getStart(sourceFile));
			let end = existing.getEnd();
			if (text[end] === ',') end += 1;
			if (text[end] === '\n') end += 1;
			writeFileSync(
				configPath,
				text.slice(0, start) + text.slice(end),
				'utf-8'
			);

			return { message: `Removed ${request.name}`, ok: true };
		}

		const valueText = serializeValue(request.value);

		if (existing) {
			const start = existing.initializer.getStart(sourceFile);
			const end = existing.initializer.getEnd();
			writeFileSync(
				configPath,
				text.slice(0, start) + valueText + text.slice(end),
				'utf-8'
			);

			return { message: `Updated ${request.name}`, ok: true };
		}

		const properties = object.properties;
		const entry = `${request.name}: ${valueText}`;
		if (properties.length > 0) {
			const last = properties[properties.length - 1];
			if (!last) {
				return {
					message: 'Could not locate insertion point.',
					ok: false
				};
			}
			const indent = indentBefore(text, last.getStart(sourceFile));
			let at = last.getEnd();
			const hasComma = text[at] === ',';
			if (hasComma) at += 1;
			const insertion = `${hasComma ? '' : ','}\n${indent}${entry}`;
			writeFileSync(
				configPath,
				text.slice(0, at) + insertion + text.slice(at),
				'utf-8'
			);
		} else {
			const at = object.getStart(sourceFile) + 1;
			const indent = `${indentBefore(text, object.getStart(sourceFile))}\t`;
			const insertion = `\n${indent}${entry}\n${indentBefore(text, object.getStart(sourceFile))}`;
			writeFileSync(
				configPath,
				text.slice(0, at) + insertion + text.slice(at),
				'utf-8'
			);
		}

		return { message: `Updated ${request.name}`, ok: true };
	} catch (error) {
		return { message: String(error), ok: false };
	}
};
