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

const findInternals = (
	mod: Record<string, unknown>
): Record<string, unknown> | undefined => {
	for (const key of INTERNALS_KEYS) {
		const val = mod[key] as Record<string, unknown> | undefined;
		if (val) return val;
	}
	return undefined;
};

export const bridgeReactInternals = async (): Promise<void> => {
	const pinned = globalThis.__reactModuleRef;
	if (!pinned) return;

	const react = await import('react');
	if (pinned === react) return;

	const pinnedInternals = findInternals(pinned as Record<string, unknown>);
	const currentInternals = findInternals(react as Record<string, unknown>);

	if (
		!pinnedInternals ||
		!currentInternals ||
		pinnedInternals === currentInternals
	)
		return;

	for (const prop of Object.keys(pinnedInternals)) {
		Object.defineProperty(currentInternals, prop, {
			get() {
				return pinnedInternals[prop];
			},
			set(v: unknown) {
				pinnedInternals[prop] = v;
			},
			configurable: true,
			enumerable: true
		});
	}
};
