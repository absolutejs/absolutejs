import type { ConfigField } from './config';

export type PackageScript = {
	command: string;
	name: string;
};

export type PackageJsonState = {
	/** Top-level keys present with a non-scalar (object/array) value. */
	complexKeys: string[];
	configPath: string | null;
	/** Scalar values literally present in the file, keyed by field name. */
	current: Record<string, unknown>;
	/** Field catalog introspected from the PackageJson type (excludes scripts). */
	fields: ConfigField[];
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
