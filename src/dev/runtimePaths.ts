import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Locate shipped browser sources from source, root bundles, or CLI bundles. */
export const resolveDevClientDirectory = () => {
	const candidates = [
		resolve(import.meta.dir, 'client'),
		resolve(import.meta.dir, 'dev/client'),
		resolve(import.meta.dir, '../dev/client')
	];
	const directory = candidates.find((candidate) =>
		existsSync(resolve(candidate, 'hmrClient.ts'))
	);
	if (!directory) {
		throw new Error(
			'AbsoluteJS browser HMR sources are missing from the installed package.'
		);
	}

	return directory;
};
