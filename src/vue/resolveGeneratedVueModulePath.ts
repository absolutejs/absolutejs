import { access, readdir, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { EXCLUDE_LAST_OFFSET } from '../constants';

const canAccess = async (path: string) => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

export const resolveGeneratedVueModulePath = async (pagePath: string) => {
	// Production manifests already contain the authoritative content-hashed
	// server asset. Import it verbatim: scanning by the unhashed page name can
	// select a stale sibling and make SSR use a different component tree than
	// the client entry hydrates.
	if (await canAccess(pagePath)) return pagePath;

	// During dev HMR the manifest can briefly retain the previous hash after
	// that file has been pruned. Fall back to the newest matching generated
	// sibling so a request racing the manifest update still recovers.
	const pageDirectory = dirname(pagePath);
	const expectedPrefix = `${basename(pagePath, '.js').split('.')[0]}.`;

	try {
		const pageEntries = await readdir(pageDirectory, {
			withFileTypes: true
		});
		const matchingEntries = pageEntries.filter(
			(entry) =>
				entry.isFile() &&
				entry.name.endsWith('.js') &&
				(entry.name ===
					`${expectedPrefix.slice(0, EXCLUDE_LAST_OFFSET)}.js` ||
					entry.name.startsWith(expectedPrefix))
		);
		const candidates = await Promise.all(
			matchingEntries.map(async (entry) => {
				const path = `${pageDirectory}/${entry.name}`;
				const metadata = await stat(path);

				return { modifiedAt: metadata.mtimeMs, path };
			})
		);
		candidates.sort(
			(left, right) =>
				right.modifiedAt - left.modifiedAt ||
				left.path.localeCompare(right.path)
		);

		return candidates[0]?.path ?? pagePath;
	} catch {
		return pagePath;
	}
};
