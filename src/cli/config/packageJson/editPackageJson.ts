import { applyEdits, modify } from 'jsonc-parser';
import { readFileSync, writeFileSync } from 'node:fs';
import type {
	PackageFieldEdit,
	PackageScriptEdit
} from '../../../../types/packageJson';

const detectFormatting = (text: string) => {
	const indent = text.match(/\n([\t ]+)\S/)?.[1];
	if (indent === undefined || indent.startsWith('\t')) {
		return { insertSpaces: false, tabSize: 1 };
	}

	return { insertSpaces: true, tabSize: indent.length };
};

const setPath = (text: string, path: (string | number)[], value: unknown) =>
	applyEdits(
		text,
		modify(text, path, value, { formattingOptions: detectFormatting(text) })
	);

export const applyScriptEdit = (
	configPath: string,
	edit: PackageScriptEdit
) => {
	try {
		let text = readFileSync(configPath, 'utf-8');

		if (edit.remove) {
			text = setPath(text, ['scripts', edit.name], undefined);
			writeFileSync(configPath, text, 'utf-8');

			return { message: `Removed script "${edit.name}"`, ok: true };
		}

		if (edit.rename && edit.rename !== edit.name) {
			text = setPath(text, ['scripts', edit.name], undefined);
			text = setPath(text, ['scripts', edit.rename], edit.command ?? '');
			writeFileSync(configPath, text, 'utf-8');

			return { message: `Renamed script to "${edit.rename}"`, ok: true };
		}

		text = setPath(text, ['scripts', edit.name], edit.command ?? '');
		writeFileSync(configPath, text, 'utf-8');

		return { message: `Updated script "${edit.name}"`, ok: true };
	} catch (error) {
		return { message: String(error), ok: false };
	}
};

export const applyFieldEdit = (configPath: string, edit: PackageFieldEdit) => {
	try {
		const text = readFileSync(configPath, 'utf-8');
		writeFileSync(
			configPath,
			setPath(text, [edit.name], edit.remove ? undefined : edit.value),
			'utf-8'
		);

		return {
			message: edit.remove
				? `Removed ${edit.name}`
				: `Updated ${edit.name}`,
			ok: true
		};
	} catch (error) {
		return { message: String(error), ok: false };
	}
};
