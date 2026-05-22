export type TsOptionKind = 'boolean' | 'string' | 'number' | 'enum' | 'list';

export type TsOption = {
	/** TypeScript's own option category, e.g. "Type Checking", "Modules". */
	category: string;
	/** Human description of the compiler default, when TypeScript provides one. */
	defaultLabel: string;
	description: string;
	/** Allowed values for `enum` kinds (and element values for enum `list`s). */
	enumValues: string[];
	kind: TsOptionKind;
	name: string;
};

export type TsConfigState = {
	categories: string[];
	/** `null` when no tsconfig/jsconfig was found in the project. */
	configPath: string | null;
	/** The literal `compilerOptions` written in the file (not resolved/inherited). */
	current: Record<string, unknown>;
	options: TsOption[];
};

export type TsEditRequest = {
	name: string;
	/** When true, delete the key from `compilerOptions` instead of setting it. */
	remove?: boolean;
	value?: unknown;
};

export type TsEditResult = {
	message: string;
	ok: boolean;
	state: TsConfigState | null;
};
