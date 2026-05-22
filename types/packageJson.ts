export type PackageScript = {
	command: string;
	name: string;
};

export type PackageFieldKind = 'string' | 'number' | 'boolean' | 'complex';

export type PackageField = {
	kind: PackageFieldKind;
	name: string;
	/** Present value for scalar fields; `null` for `complex` (object/array). */
	value: unknown;
};

export type PackageJsonState = {
	configPath: string | null;
	/** Top-level fields actually present in the file (excluding `scripts`). */
	fields: PackageField[];
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
