/* Runtime loader for the build-emitted per-page providers module.
 *
 * The build (`runAngularHandlerScan`) emits one
 * `.absolutejs/generated/angular/providers/<ManifestKey>.providers.ts`
 * per page. Each file's `providers` export is the combination of:
 *   - global providers from `angular.providersImport` in absolute.config.ts
 *   - per-call `providers:` arg from the handler call (if any)
 *   - auto-wired `provideRouter(routes)` when the page exports routes
 *   - inferred `APP_BASE_HREF` for sub-router mounts
 *
 * Client bundle imports the file at build time. The SSR handler
 * dynamic-imports the same file at request time so both DI trees come
 * from the same source. Cached per manifest key. */

import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { getFrameworkGeneratedDir } from '../utils/generatedDir';
import { toPascal } from '../utils/stringModifiers';

const cache = new Map<string, ReadonlyArray<Provider | EnvironmentProviders>>();

/** Derive the manifest key (PascalCase basename) from the page's
 *  resolved source path. Matches `generateManifest`'s convention for
 *  Angular `pages/` so `home/home.ts` → `Home`,
 *  `portal/portal.ts` → `Portal`, etc.
 *
 *  Runtime callers may pass any of:
 *    - the source `.ts` path                            (`home.ts`)
 *    - the AOT/JIT compiled output                      (`home.js`)
 *    - dev's `rebuildTrigger` server-vendor-rewritten   (`home.ssr.js`)
 *    - the production hashed artifact path              (`home.zpqs628y.js`)
 *    - a combination of the above                       (`home.ssr.zpqs628y.js`)
 *
 *  Strip every known build-time suffix before pascalizing so all
 *  shapes resolve to the same manifest key the build emitted under
 *  `<ManifestKey>.providers.ts`. The build's own `getArtifactBaseName`
 *  uses the artifact's hash metadata to strip the content hash; at
 *  runtime we don't have that metadata, so we match the shape Bun
 *  produces — `.<8 lowercase base36>` immediately before the
 *  extension. The `.ssr` infix is dev-only and comes from
 *  `rebuildTrigger`'s sibling-file pattern. */
const BUN_CONTENT_HASH = /\.[a-z0-9]{8}$/;
const SSR_INFIX = /\.ssr$/;

export const manifestKeyForPagePath = (pageSourcePath: string) => {
	let stem = basename(pageSourcePath).replace(/\.[cm]?[tj]sx?$/, '');
	// Repeated trims so combinations like `home.ssr.zpqs628y.js` collapse
	// regardless of which suffix the build wrote last.
	let prev: string;
	do {
		prev = stem;
		stem = stem.replace(BUN_CONTENT_HASH, '').replace(SSR_INFIX, '');
	} while (stem !== prev);

	return toPascal(stem);
};

export const loadPageProviders = async (
	pageSourcePath: string
): Promise<ReadonlyArray<Provider | EnvironmentProviders>> => {
	const manifestKey = manifestKeyForPagePath(pageSourcePath);
	const cached = cache.get(manifestKey);
	if (cached) return cached;

	const generatedFile = join(
		getFrameworkGeneratedDir('angular', process.cwd()),
		'providers',
		`${manifestKey}.providers.ts`
	);
	if (!existsSync(generatedFile)) {
		cache.set(manifestKey, []);

		return [];
	}

	try {
		const mod: {
			providers?: ReadonlyArray<Provider | EnvironmentProviders>;
		} = await import(generatedFile);
		const providers = Array.isArray(mod.providers) ? mod.providers : [];
		cache.set(manifestKey, providers);

		return providers;
	} catch (error) {
		console.warn(
			`[absolute/angular] failed to load generated providers for "${manifestKey}":`,
			error
		);
		cache.set(manifestKey, []);

		return [];
	}
};
