export type ConfigPanelId =
	| 'absolute'
	| 'package'
	| 'eslint'
	| 'tsconfig'
	| 'prettier';

export type ConfigPanelStatus = 'ready' | 'soon';

export type ConfigPanelMeta = {
	/** One-line description shown under the panel name in the sidebar. */
	blurb: string;
	id: ConfigPanelId;
	label: string;
	/** `'ready'` panels are interactive; `'soon'` panels render a placeholder. */
	status: ConfigPanelStatus;
};

export type ConfigFieldKind =
	| 'string'
	| 'number'
	| 'boolean'
	| 'enum'
	| 'complex';

/** A field recovered from a TypeScript type by introspection — the shared unit
 *  the absolute.config and package.json panels render. */
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
