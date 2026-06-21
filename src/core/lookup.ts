import { isProductionRuntime } from '../utils/runtimeMode';

export const asset = (source: Record<string, string>, name: string) => {
	const assetPath = source[name];

	if (assetPath === undefined) {
		// Production: a missing manifest key is a real build error — fail loud.
		if (isProductionRuntime()) {
			throw new Error(`Asset "${name}" not found in manifest.`);
		}

		// Dev mode: the asset likely hasn't been built yet (transient state
		// between edits). Return an empty placeholder so the page still renders;
		// the next hot-reload picks up the real asset once it exists.
		console.warn(
			`[asset] key "${name}" not found in manifest (dev mode — skipping)`
		);

		return '';
	}

	return assetPath;
};
