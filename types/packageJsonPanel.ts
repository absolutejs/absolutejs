import type { FieldNode } from './config';

export type PackageScript = {
	command: string;
	name: string;
};

export type PackageJsonState = {
	configPath: string | null;
	/** Top-level values present in the file (excluding `scripts`). */
	current: Record<string, unknown>;
	/** Field catalog from the PackageJson type + any extra keys in the file. */
	fields: FieldNode[];
	scripts: PackageScript[];
};

export type PackageScriptEdit = {
	command?: string;
	name: string;
	remove?: boolean;
	rename?: string;
};

export type PackageFieldEdit = {
	name: string;
	remove?: boolean;
	value?: unknown;
};

export type PackageJsonEditResult = {
	message: string;
	ok: boolean;
	state: PackageJsonState | null;
};
