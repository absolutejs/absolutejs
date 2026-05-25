import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { findAuthSettingsObject } from './resolveAuthSettings';
import { serializeValue } from '../schema/serialize';
import type { AuthConfigEditRequest } from '../../../../types/authPanel';

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

// Edits the `defineAuthSettings({...})` object literal by splicing source text
// around AST node positions, so imports / comments / the rest of auth.config.ts
// stay untouched. Only scalar data values are written here (code stays in code).
export const applyAuthConfigEdit = (
	configPath: string,
	request: AuthConfigEditRequest
) => {
	try {
		const text = readFileSync(configPath, 'utf-8');
		const sourceFile = ts.createSourceFile(
			configPath,
			text,
			ts.ScriptTarget.Latest,
			true
		);
		const object = findAuthSettingsObject(sourceFile);
		if (!object) {
			return {
				message:
					'Could not find defineAuthSettings({ ... }) in auth.config.ts.',
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

		const { properties } = object;
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
			let insertAt = last.getEnd();
			const hasComma = text[insertAt] === ',';
			if (hasComma) insertAt += 1;
			const insertion = `${hasComma ? '' : ','}\n${indent}${entry}`;
			writeFileSync(
				configPath,
				text.slice(0, insertAt) + insertion + text.slice(insertAt),
				'utf-8'
			);
		} else {
			const insertAt = object.getStart(sourceFile) + 1;
			const indent = `${indentBefore(text, object.getStart(sourceFile))}\t`;
			const insertion = `\n${indent}${entry}\n${indentBefore(text, object.getStart(sourceFile))}`;
			writeFileSync(
				configPath,
				text.slice(0, insertAt) + insertion + text.slice(insertAt),
				'utf-8'
			);
		}

		return { message: `Updated ${request.name}`, ok: true };
	} catch (error) {
		return { message: String(error), ok: false };
	}
};
