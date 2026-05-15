/* Runtime loader for the build-emitted route-mounts map. Cached after
 * the first call so per-request dispatch in `handleAngularPageRequest`
 * is a synchronous map lookup, not an `await import()`.
 *
 * Resolves the path relative to `process.cwd()`, which is where
 * `runAngularHandlerScan` wrote the file at build time. If the file
 * doesn't exist (project hasn't run a build yet, framework consumer
 * isn't using Angular handler calls), we cache an empty list. */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getFrameworkGeneratedDir } from '../utils/generatedDir';
import type { AngularRouteMount } from '../../types/angular';

let cached: AngularRouteMount[] | null = null;

export const loadAngularRouteMounts = async (): Promise<
	AngularRouteMount[]
> => {
	if (cached) return cached;

	const filePath = join(
		getFrameworkGeneratedDir('angular', process.cwd()),
		'route-mounts.ts'
	);
	if (!existsSync(filePath)) {
		cached = [];

		return cached;
	}

	try {
		const mod: { routeMounts?: AngularRouteMount[] } = await import(
			filePath
		);
		cached = mod.routeMounts ?? [];
	} catch (error) {
		console.warn('[absolute/angular] failed to load route-mounts:', error);
		cached = [];
	}

	return cached;
};

export const matchAngularBasePath = (
	mounts: AngularRouteMount[],
	urlPath: string
): string => {
	for (const mount of mounts) {
		if (mount.pattern.test(urlPath)) return mount.basePath;
	}

	return '/';
};
