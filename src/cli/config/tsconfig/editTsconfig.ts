import { applyEdits, modify } from 'jsonc-parser';
import { readFileSync, writeFileSync } from 'node:fs';
import type { TsEditRequest } from '../../../../types/tsconfig';

// Match the file's existing indentation so jsonc-parser formats inserted keys
// to look hand-written. Defaults to tabs (the AbsoluteJS house style).
const detectFormatting = (text: string) => {
	const indent = text.match(/\n([\t ]+)\S/)?.[1];
	if (indent === undefined || indent.startsWith('\t')) {
		return { insertSpaces: false, tabSize: 1 };
	}

	return { insertSpaces: true, tabSize: indent.length };
};

// jsonc-parser's modify/applyEdits performs a surgical splice — comments and
// untouched formatting in the rest of the file are preserved.
export const applyTsconfigEdit = (
	configPath: string,
	request: TsEditRequest
) => {
	try {
		const text = readFileSync(configPath, 'utf-8');
		const edits = modify(
			text,
			['compilerOptions', request.name],
			request.remove ? undefined : request.value,
			{ formattingOptions: detectFormatting(text) }
		);
		writeFileSync(configPath, applyEdits(text, edits), 'utf-8');

		return {
			message: request.remove
				? `Removed ${request.name}`
				: `Updated ${request.name}`,
			ok: true
		};
	} catch (error) {
		return { message: String(error), ok: false };
	}
};
