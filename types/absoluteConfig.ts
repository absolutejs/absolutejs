import type { FieldNode } from './config';

export type AbsoluteConfigState = {
	/** False when the BuildConfig type couldn't be resolved (catalog empty). */
	available: boolean;
	configPath: string | null;
	/** Values literally present in defineConfig({...}), read recursively. */
	current: Record<string, unknown>;
	/** Top-level keys whose value contains code (refs/calls) — not form-editable. */
	opaqueKeys: string[];
	/** Recursive field catalog introspected from BaseBuildConfig. */
	fields: FieldNode[];
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
