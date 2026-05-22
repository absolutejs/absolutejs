export type RuleSeverity = 'off' | 'warn' | 'error';

/** `'core'` for ESLint built-ins, otherwise the plugin prefix (e.g.
 *  `'@typescript-eslint'`, `'@stylistic'`, `'absolute'`, `'promise'`). */
export type RuleSource = string;

export type RuleMeta = {
	deprecated: boolean;
	description: string | null;
	docsUrl: string | null;
	/** `'code'` or `'whitespace'` when the rule ships an autofix. */
	fixable: string | null;
	hasSuggestions: boolean;
	/** Full rule id, e.g. `'no-debugger'` or `'@typescript-eslint/no-explicit-any'`. */
	name: string;
	/** JSON-schema-ish options descriptor used to drive the options editor. */
	schema: unknown;
	shortName: string;
	source: RuleSource;
	/** `'problem' | 'suggestion' | 'layout'` per the rule's metadata. */
	type: string | null;
};

/** A rule literally written into a source block's `rules` object — the
 *  unit the Studio can edit in place. */
export type ConfiguredRule = {
	name: string;
	options: unknown[];
	/** Verbatim source text of the value node (for diff display). */
	rawValue: string;
	severity: RuleSeverity;
};

export type ConfigBlock = {
	files: string[];
	/** A standalone `{ ignores: [...] }` block — has no editable rules. */
	isGlobalIgnore: boolean;
	/** Human label derived from the block's `files` patterns. */
	label: string;
	rules: ConfiguredRule[];
	/** Index into the source `defineConfig([...])` array element list. */
	sourceIndex: number;
};

export type EffectiveRule = {
	name: string;
	options: unknown[];
	severity: RuleSeverity;
};

export type RuleCatalog = {
	configPath: string;
	/** Editable source blocks with the rules they literally configure. */
	blocks: ConfigBlock[];
	/** Resolved ruleset for `representativeFile`, after all blocks merge. */
	effective: EffectiveRule[];
	generatedAt: string;
	/** Every rule available from core + every loaded plugin. */
	meta: RuleMeta[];
	representativeFile: string;
};

export type RuleEditRequest = {
	name: string;
	options?: unknown[];
	severity: RuleSeverity;
	/** Source block to edit. When the rule is absent there, it is inserted
	 *  in sorted position; pass the broad block to add a project-wide rule. */
	sourceIndex: number;
};

export type RuleEditResult = {
	catalog: RuleCatalog | null;
	message: string | null;
	ok: boolean;
};
