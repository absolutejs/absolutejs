import type { ManifestKey } from '../../types/manifest';
import { isProductionRuntime } from '../utils/runtimeMode';
import { getDevPageWarmer, recordMissingAsset } from './requestContext';

const DOUBLED_RSC_SUFFIX = 'RSCRSC';
const warnedDoubledRscKeys = new Set<string>();

/* A React Server Components page whose file name ends in RSC (HomeRSC.tsx)
 * used to get the key `HomeRSCRSC`; it is now `HomeRSC`, and the old key is
 * kept as a deprecated alias pointing at the same bundle. */
const warnDoubledRscKey = (
	source: Record<string, string>,
	name: string,
	assetPath: string
) => {
	if (!name.endsWith(DOUBLED_RSC_SUFFIX)) return;
	const current = name.slice(0, -'RSC'.length);
	if (source[current] !== assetPath || warnedDoubledRscKeys.has(name)) return;
	warnedDoubledRscKeys.add(name);
	console.warn(
		`[asset] key "${name}" is deprecated: React Server Components pages whose file name ends in RSC no longer get the suffix twice. Use asset(manifest, '${current}').`
	);
};

/**
 * The built path of a manifest entry: `asset(manifest, 'HomeIndex')`.
 *
 * The key is checked at compile time against the keys the project's build
 * writes (see `AbsoluteManifestKeys`), so a misspelled key is a type error
 * rather than a runtime one. Use `assetUnchecked` for a key computed at
 * runtime.
 */
export const asset = (source: Record<string, string>, name: ManifestKey) =>
	assetUnchecked(source, name);

/**
 * `asset` for a key that is only known at runtime (`${name}Index`): the same
 * lookup, without the compile-time check that the key is one the project's
 * build writes.
 */
export const assetUnchecked = (
	source: Record<string, string>,
	name: string
) => {
	const assetPath = source[name];

	if (assetPath === undefined) {
		// Production: a missing manifest key is a real build error — fail loud.
		if (isProductionRuntime()) {
			throw new Error(`Asset "${name}" not found in manifest.`);
		}

		// Dev mode: the asset likely hasn't been built yet. Record the miss on
		// the request context so the page handler can build the page on
		// demand (see `resolveDeferredPageAssets`), and return an empty
		// placeholder — the handler re-reads the manifest once the build
		// lands, or throws the manifest error if it fails.
		recordMissingAsset(name);
		const page = getDevPageWarmer()?.describe(name);
		// A page that will be built by this request needs no warning; keep
		// it for keys that are not a deferred page (or whose page is built
		// and really lacks this key, e.g. optional CSS).
		if (page !== undefined && !page.built) return '';
		console.warn(
			`[asset] key "${name}" not found in manifest (dev mode — skipping)`
		);

		return '';
	}

	if (!isProductionRuntime()) warnDoubledRscKey(source, name, assetPath);

	return assetPath;
};
