import type { SupportOption } from 'prettier';

/** `json` = an editable JSON config (.prettierrc/.prettierrc.json) · `package`
 *  = the `prettier` key in package.json · `other` = a JS/YAML config we won't
 *  rewrite · `none` = no config yet (edits create .prettierrc.json). */
export type PrettierFormat = 'json' | 'package' | 'other' | 'none';

export type PrettierState = {
	/** False when prettier can't be resolved at runtime (not installed). */
	available: boolean;
	categories: string[];
	configPath: string | null;
	current: Record<string, unknown>;
	editable: boolean;
	format: PrettierFormat;
	/** Option metadata straight from `prettier.getSupportInfo()`. */
	options: SupportOption[];
};

export type PrettierEditRequest = {
	name: string;
	remove?: boolean;
	value?: unknown;
};

export type PrettierEditResult = {
	message: string;
	ok: boolean;
	state: PrettierState | null;
};
