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

/** A normalized, recursive description of a value's shape — produced from a TS
 *  type (config panels) or a JSON Schema (ESLint rule options), and consumed by
 *  the recursive FieldEditor so every value gets a real UI instead of raw JSON.
 *  `opaque` is the last resort: a value we can't safely structure-edit (e.g. it
 *  references an imported binding); `typeText` is shown for it. */
export type FieldSchema =
	| { kind: 'string' }
	| { kind: 'number' }
	| { kind: 'boolean' }
	| { kind: 'enum'; choices: (string | number)[] }
	| { kind: 'array'; item: FieldSchema }
	| { kind: 'object'; fields: FieldNode[] }
	| { kind: 'record'; value: FieldSchema }
	| { kind: 'union'; variants: FieldSchema[] }
	| { kind: 'opaque'; typeText: string };

/** A named field within an object schema (or a top-level config field). */
export type FieldNode = {
	description: string;
	name: string;
	optional: boolean;
	schema: FieldSchema;
};
