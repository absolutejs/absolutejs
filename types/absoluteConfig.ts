import type { ConfigField } from './config';

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
