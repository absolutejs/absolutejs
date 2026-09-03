import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { rewriteImportsInContent } from '../build/rewriteImportsPlugin';

const PREVIEW_CLIENT_FILE = 'mobilePreviewClient.ts';

const fileExists = (path: string) =>
	access(path).then(
		() => true,
		() => false
	);

/** The preview client ships as raw TypeScript beside this module in a source
 *  checkout (`src/mobile/`) and beside the bundled runtime in a published
 *  package (`dist/mobile/`, next to `dist/index.js`). */
export const resolveAbsoluteMobilePreviewClientEntry = async () => {
	const candidates = [
		join(import.meta.dir, PREVIEW_CLIENT_FILE),
		join(import.meta.dir, 'mobile', PREVIEW_CLIENT_FILE)
	];
	const present = await Promise.all(candidates.map(fileExists));
	const entry = candidates.find((_candidate, index) => present[index]);
	if (entry) return entry;
	throw new TypeError('The AbsoluteJS mobile preview client is missing.');
};

/** Leaves every bare specifier that the page graph already vendors external
 *  so the preview shares one `@absolutejs/devices` / `@absolutejs/http`
 *  instance with application code; anything else is inlined. Matching is
 *  exact — Bun's `external` list treats entries as prefixes, which would
 *  strand `@absolutejs/devices/testing` as a bare specifier whenever only
 *  `@absolutejs/devices` is vendored. */
const createVendorExternalsPlugin = (
	vendorPaths: Record<string, string>
): Bun.BunPlugin => ({
	name: 'absolutejs-mobile-preview-vendor-externals',
	setup(build) {
		build.onResolve({ filter: /^[^./]/ }, ({ path }) =>
			path in vendorPaths ? { external: true, path } : undefined
		);
	}
});

export const buildAbsoluteMobilePreviewClient = async (
	vendorPaths: Record<string, string>
) => {
	const entry = await resolveAbsoluteMobilePreviewClientEntry();
	const result = await Bun.build({
		entrypoints: [entry],
		format: 'esm',
		minify: false,
		plugins: [createVendorExternalsPlugin(vendorPaths)],
		target: 'browser'
	});
	const [output] = result.outputs;
	if (!result.success || !output || result.outputs.length !== 1) {
		throw new AggregateError(
			result.logs,
			'Failed to build the AbsoluteJS mobile preview client.'
		);
	}

	return rewriteImportsInContent(await output.text(), vendorPaths);
};

type CachedPreviewBundle = {
	bundle: Promise<string>;
	vendorPaths: Record<string, string> | undefined;
};

let cachedBundle: CachedPreviewBundle | undefined;

/** Memoized per dependency-vendor map: a rebuild that vendors a new package
 *  replaces the map object, which invalidates the cached bundle so the
 *  preview keeps sharing module instances with the pages it drives. */
export const getAbsoluteMobilePreviewClientBundle = () => {
	const vendorPaths = globalThis.__depVendorPaths;
	if (cachedBundle && cachedBundle.vendorPaths === vendorPaths) {
		return cachedBundle.bundle;
	}
	const bundle = buildAbsoluteMobilePreviewClient(vendorPaths ?? {});
	const entry: CachedPreviewBundle = { bundle, vendorPaths };
	cachedBundle = entry;
	bundle.catch(() => {
		if (cachedBundle === entry) cachedBundle = undefined;
	});

	return bundle;
};
