/**
 * After `bun install` adds new packages, Bun's module cache can resolve
 * `react` to a new instance while `react-dom/server` still holds the original.
 * The two copies have separate shared-internals objects, so the hook dispatcher
 * set by react-dom is invisible to hooks in user components — "Invalid hook call".
 *
 * This bridges the new React's internals to the pinned (original) instance via
 * property descriptors so both share one dispatcher.
 *
 * React 19 renamed the internals key from
 * `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` to
 * `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE`.
 * We try both so the fix works across versions.
 */
const INTERNALS_KEYS = [
	'__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE',
	'__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED'
] as const;

const isRecord = (val: unknown): val is Record<string, unknown> =>
	typeof val === 'object' && val !== null;

const findInternals = (mod: Record<string, unknown>) => {
	for (const key of INTERNALS_KEYS) {
		const val = mod[key];
		if (isRecord(val)) return val;
	}

	return undefined;
};

export const bridgeReactInternals = async () => {
	const pinned: Record<string, unknown> | undefined =
		globalThis.__reactModuleRef;
	if (!pinned) return;

	const react: Record<string, unknown> = await import('react');
	if (pinned === react) return;

	const pinnedInternals = findInternals(pinned);
	const currentInternals = findInternals(react);

	if (
		!pinnedInternals ||
		!currentInternals ||
		pinnedInternals === currentInternals
	)
		return;

	for (const prop of Object.keys(pinnedInternals)) {
		Object.defineProperty(currentInternals, prop, {
			configurable: true,
			enumerable: true,
			get() {
				return pinnedInternals[prop];
			},
			set(value: unknown) {
				pinnedInternals[prop] = value;
			}
		});
	}
};
