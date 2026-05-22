export type ConfigFieldKind =
	| 'string'
	| 'number'
	| 'boolean'
	| 'enum'
	| 'complex';

export type ConfigField = {
	/** Allowed values for `enum` kinds; empty otherwise. */
	choices: string[];
	description: string;
	kind: ConfigFieldKind;
	name: string;
	optional: boolean;
	/** The field's TypeScript type, shown for `complex` (read-only) fields. */
	typeText: string;
};

export type AbsoluteConfigState = {
	/** False when the BuildConfig type couldn't be resolved (catalog empty). */
	available: boolean;
	configPath: string | null;
	/** Simple top-level values literally present in defineConfig({...}). */
	current: Record<string, unknown>;
	/** Top-level keys present with a non-scalar (object/array/ref) value. */
	complexKeys: string[];
	fields: ConfigField[];
};

export type AbsoluteConfigEditRequest = {
	name: string;
	remove?: boolean;
	value?: unknown;
};

export type AbsoluteConfigEditResult = {
	message: string;
	ok: boolean;
	state: AbsoluteConfigState | null;
};
