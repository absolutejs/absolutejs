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
 *  `portal/portal.ts` → `Portal`, etc. */
export const manifestKeyForPagePath = (pageSourcePath: string) =>
	toPascal(basename(pageSourcePath).replace(/\.[cm]?[tj]sx?$/, ''));

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
