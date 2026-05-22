import { applyEdits, modify } from 'jsonc-parser';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
	PrettierEditRequest,
	PrettierFormat
} from '../../../../types/prettier';

// Match existing indentation so inserted keys look hand-written; tabs by default.
const detectFormatting = (text: string) => {
	const indent = text.match(/\n([\t ]+)\S/)?.[1];
	if (indent === undefined || indent.startsWith('\t')) {
		return { insertSpaces: false, tabSize: 1 };
	}

	return { insertSpaces: true, tabSize: indent.length };
};

// jsonc-parser keeps comments and untouched formatting intact. For `package`
// the key lives under `prettier`; otherwise we edit (or create) .prettierrc.json.
export const applyPrettierEdit = (
	cwd: string,
	format: PrettierFormat,
	configPath: string | null,
	request: PrettierEditRequest
) => {
	try {
		const target =
			format === 'package'
				? resolve(cwd, 'package.json')
				: (configPath ?? resolve(cwd, '.prettierrc.json'));
		const path =
			format === 'package' ? ['prettier', request.name] : [request.name];
		const text = existsSync(target)
			? readFileSync(target, 'utf-8')
			: '{}\n';
		const edits = modify(
			text,
			path,
			request.remove ? undefined : request.value,
			{ formattingOptions: detectFormatting(text) }
		);
		writeFileSync(target, applyEdits(text, edits), 'utf-8');

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
